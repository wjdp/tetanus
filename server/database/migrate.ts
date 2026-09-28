import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Database } from "better-sqlite3";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import type * as schema from "./schema";

type DrizzleDb = BetterSQLite3Database<typeof schema>;

type JournalEntry = { tag: string; when: number };

export type MigrationReport = {
  applied: string[];
  total: number;
  durationMs: number;
};

export function migrationsFolder() {
  return join(process.cwd(), "server", "database", "migrations");
}

function journalEntries(): JournalEntry[] {
  const journal = JSON.parse(
    readFileSync(join(migrationsFolder(), "meta", "_journal.json"), "utf8"),
  ) as { entries: JournalEntry[] };
  return journal.entries;
}

function lastAppliedMillis(sqlite: Database): number | undefined {
  const tableExists = sqlite
    .prepare(
      `SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = '__drizzle_migrations'`,
    )
    .get();
  if (!tableExists) return undefined;
  const row = sqlite
    .prepare(`SELECT max(created_at) AS millis FROM __drizzle_migrations`)
    .get() as { millis: number | null };
  return row.millis ?? undefined;
}

// Mirrors drizzle's own rule: a migration is pending when its journal
// timestamp is newer than the most recently recorded one.
function pendingMigrations(sqlite: Database) {
  const entries = journalEntries();
  const last = lastAppliedMillis(sqlite);
  return {
    total: entries.length,
    pending: entries
      .filter((entry) => last === undefined || entry.when > last)
      .map((entry) => entry.tag),
  };
}

// SQLite cannot alter a column's type, so drizzle-kit emits table rebuilds:
// copy into `__new_X`, drop the original, rename. Dropping a table other rows
// reference trips foreign keys, and the `PRAGMA foreign_keys=OFF` drizzle-kit
// writes into the migration is a no-op inside the migrator's transaction, as is
// `PRAGMA defer_foreign_keys=ON` once the deferred violation counter is raised.
// Disabling enforcement for the duration and checking integrity afterwards is
// what the SQLite manual prescribes for this class of migration.
function migrateWithoutForeignKeyEnforcement(db: DrizzleDb, sqlite: Database) {
  const [{ foreign_keys: wasEnabled }] = sqlite.pragma("foreign_keys") as [
    { foreign_keys: number },
  ];
  sqlite.pragma("foreign_keys = OFF");
  try {
    migrate(db, { migrationsFolder: migrationsFolder() });
    const violations = sqlite.pragma("foreign_key_check") as unknown[];
    if (violations.length > 0) {
      throw new Error(
        `Migration left ${violations.length} foreign key violations: ${JSON.stringify(violations)}`,
      );
    }
  } finally {
    if (wasEnabled) sqlite.pragma("foreign_keys = ON");
  }
}

export function runMigrations(
  sqlite: Database,
  db: DrizzleDb,
): MigrationReport {
  const { total, pending } = pendingMigrations(sqlite);
  const startedAt = performance.now();
  migrateWithoutForeignKeyEnforcement(db, sqlite);
  return {
    applied: pending,
    total,
    durationMs: Math.round(performance.now() - startedAt),
  };
}

export function describeMigrations(
  report: MigrationReport,
  databasePath: string,
) {
  if (report.applied.length === 0) {
    return `Database up to date, ${report.total} migrations already applied (${databasePath})`;
  }
  const list = report.applied.map((tag) => `  ✔ ${tag}`).join("\n");
  return `Database migrated, applied ${report.applied.length} new ${report.applied.length === 1 ? "migration" : "migrations"} in ${report.durationMs}ms, ${report.total} total (${databasePath})\n${list}`;
}
