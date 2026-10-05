import { drizzle } from "drizzle-orm/durable-sqlite";
import { migrate } from "drizzle-orm/durable-sqlite/migrator";
import { boundStorage } from "./bridge";
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

export function latestAppliedMigration(_sqlite?: unknown): string | null {
  const last = lastAppliedMillis(boundStorage());
  if (last === undefined) return null;
  return (
    bundle.journal.entries.find((entry) => entry.when === last)?.tag ?? null
  );
}

function pendingEntries(storage: DurableObjectStorage) {
  const last = lastAppliedMillis(storage);
  return bundle.journal.entries.filter(
    (entry) => last === undefined || entry.when > last,
  );
}

function migrationStatements(entry: { idx: number }) {
  const key = `m${entry.idx.toString().padStart(4, "0")}`;
  const sql = bundle.migrations[key as keyof typeof bundle.migrations];
  return sql.split("--> statement-breakpoint");
}

class Replayed extends Error {}

// Drizzle's migrator swallows the failing statement's error and throws a bare
// "Rollback", so replay the pending statements in a transaction that is always
// rolled back to find which one fails and why.
function describeMigrationFailure(
  storage: DurableObjectStorage,
  pending: ReturnType<typeof pendingEntries>,
) {
  let failure = "no statement failed on replay";
  try {
    storage.transactionSync(() => {
      for (const entry of pending) {
        for (const statement of migrationStatements(entry)) {
          try {
            storage.sql.exec(statement);
          } catch (error) {
            const message =
              error instanceof Error ? error.message : String(error);
            failure = `${entry.tag}: ${message}`;
            throw new Replayed();
          }
        }
      }
      throw new Replayed();
    });
  } catch (error) {
    if (!(error instanceof Replayed)) throw error;
  }
  return failure;
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
  const pending = pendingEntries(storage);
  const startedAt = performance.now();
  if (pending.length > 0) {
    storage.sql.exec("PRAGMA defer_foreign_keys = ON");
    try {
      try {
        await migrate(drizzle(storage), bundle);
      } catch (error) {
        throw new Error(
          `Migration failed: ${describeMigrationFailure(storage, pending)}`,
          { cause: error },
        );
      }
      assertNoForeignKeyViolations(storage);
    } finally {
      storage.sql.exec("PRAGMA defer_foreign_keys = OFF");
    }
  }
  return {
    applied: pending.map((entry) => entry.tag),
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
