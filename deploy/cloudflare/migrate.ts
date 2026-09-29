import { drizzle } from "drizzle-orm/durable-sqlite";
import { migrate } from "drizzle-orm/durable-sqlite/migrator";
import bundle from "./migrations";

export type MigrationReport = {
  applied: string[];
  total: number;
  durationMs: number;
};

function lastAppliedMillis(storage: DurableObjectStorage): number | undefined {
  const [table] = storage.sql
    .exec(
      `SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = '__drizzle_migrations'`,
    )
    .toArray();
  if (!table) return undefined;
  const [row] = storage.sql
    .exec<{ millis: number | null }>(
      `SELECT max(created_at) AS millis FROM __drizzle_migrations`,
    )
    .toArray();
  return row?.millis ?? undefined;
}

function pendingMigrations(storage: DurableObjectStorage) {
  const last = lastAppliedMillis(storage);
  return bundle.journal.entries
    .filter((entry) => last === undefined || entry.when > last)
    .map((entry) => entry.tag);
}

function assertNoForeignKeyViolations(storage: DurableObjectStorage) {
  const violations = storage.sql.exec("PRAGMA foreign_key_check").toArray();
  if (violations.length > 0) {
    throw new Error(
      `Migration left ${violations.length} foreign key violations: ${JSON.stringify(violations)}`,
    );
  }
}

// server/database/migrate.ts turns foreign key enforcement off around the run.
// DO SQLite silently ignores `PRAGMA foreign_keys = OFF`, so deferring is the
// closest equivalent: violations are checked at the end of the Durable
// Object's implicit transaction instead of per statement, and one still
// present then resets the object, so check first and fail with the details.
export async function migrateStorage(
  storage: DurableObjectStorage,
): Promise<MigrationReport> {
  const pending = pendingMigrations(storage);
  const startedAt = performance.now();
  if (pending.length > 0) {
    storage.sql.exec("PRAGMA defer_foreign_keys = ON");
    try {
      await migrate(drizzle(storage), bundle);
      assertNoForeignKeyViolations(storage);
    } finally {
      storage.sql.exec("PRAGMA defer_foreign_keys = OFF");
    }
  }
  return {
    applied: pending,
    total: bundle.journal.entries.length,
    durationMs: Math.round(performance.now() - startedAt),
  };
}

// The Nitro migrate plugin calls this synchronously at start-up, after the
// Durable Object has already run migrateStorage, so it only reports.
export function runMigrations(): MigrationReport {
  return { applied: [], total: bundle.journal.entries.length, durationMs: 0 };
}

export function describeMigrations(report: MigrationReport) {
  return `Durable Object database at ${report.total} migrations`;
}
