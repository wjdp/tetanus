import bundle from "./schemaBundle";

export type MigrationReport = {
  applied: string[];
  total: number;
  durationMs: number;
};

const SCHEMA_KEY = "schemaHash";

// The demo's data is reseeded, never kept, so rather than replay migrations
// written for real installs (whose data fixes Durable Object SQLite may refuse)
// it rebuilds from the current schema whenever that changes.
export async function prepareSchema(
  storage: DurableObjectStorage,
): Promise<{ rebuilt: boolean }> {
  if ((await storage.get<string>(SCHEMA_KEY)) === bundle.hash) {
    return { rebuilt: false };
  }
  await storage.deleteAll();
  storage.sql.exec(bundle.sql);
  await storage.put(SCHEMA_KEY, bundle.hash);
  console.log(`Demo database rebuilt at schema ${bundle.hash}`);
  return { rebuilt: true };
}

export function latestAppliedMigration(_sqlite?: unknown): string | null {
  return bundle.latestMigration;
}

// The Nitro migrate plugin calls this at start-up, after the Durable Object has
// already run prepareSchema, so it only reports.
export function runMigrations(): MigrationReport {
  return { applied: [], total: 0, durationMs: 0 };
}

export function describeMigrations(_report: MigrationReport) {
  return `Durable Object database at schema ${bundle.hash} (${bundle.latestMigration})`;
}
