import { parseArgs } from "node:util";

// Services reach for a few Nitro auto-imports; outside Nitro these stand in, as the
// unit test project's Nuxt environment does. `useStorage` stays undefined, so ingest's
// alerts request fails fast and nothing is queued.
const runtimeConfig = { public: { demo: false } };
Object.assign(globalThis, {
  useRuntimeConfig: () => runtimeConfig,
  createError: ({ statusMessage }: { statusMessage?: string }) =>
    new Error(statusMessage),
});

const USAGE = `Usage: demo <seed|tick> [--reset] [--now <iso>]

  seed    replay the demo fleet into an empty database (DATABASE_URL, default ./dev.db)
  tick    one collector run per host for the current hour
  --reset delete every row first (seed only); keeps the file, so a running dev server keeps its connection
  --now   pretend it is this instant (ISO 8601)`;

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    reset: { type: "boolean", default: false },
    now: { type: "string" },
    help: { type: "boolean", short: "h", default: false },
  },
});

const [command] = positionals;
if (values.help || (command !== "seed" && command !== "tick")) {
  console.log(USAGE);
  process.exit(values.help ? 0 : 1);
}

const now = values.now ? new Date(values.now) : new Date();
if (Number.isNaN(now.getTime())) {
  console.error(`Not a date: ${values.now}`);
  process.exit(1);
}

const { databasePath, db, sqlite } = await import("~~/server/database/client");
const { describeMigrations, runMigrations } = await import(
  "~~/server/database/migrate"
);
const { seed, tick } = await import("./seed");

console.log(describeMigrations(runMigrations(sqlite, db), databasePath()));

function userTables(): string[] {
  return sqlite
    .prepare(
      `SELECT name FROM sqlite_master WHERE type = 'table'
         AND name NOT LIKE 'sqlite_%' AND name != '__drizzle_migrations'`,
    )
    .pluck()
    .all() as string[];
}

function rowCount(table: string): number {
  return sqlite
    .prepare(`SELECT count(*) FROM "${table}"`)
    .pluck()
    .get() as number;
}

/** Inside a transaction, where `foreign_keys = OFF` is a no-op: checks wait for the commit instead. */
function deleteAllRows() {
  const hasSequence = sqlite
    .prepare(
      `SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'sqlite_sequence'`,
    )
    .get();
  sqlite.pragma("defer_foreign_keys = ON");
  for (const table of userTables()) {
    sqlite.prepare(`DELETE FROM "${table}"`).run();
  }
  if (hasSequence) sqlite.prepare("DELETE FROM sqlite_sequence").run();
}

function printCounts() {
  const counts = Object.fromEntries(
    userTables()
      .map((table) => [table, rowCount(table)] as const)
      .filter(([, count]) => count > 0),
  );
  console.table(counts);
}

// One transaction, so a running dev server keeps serving the old rows (and cannot
// stamp half-replayed disks with the wall clock) until the new ones are complete.
async function inTransaction<T>(work: () => Promise<T>): Promise<T> {
  sqlite.exec("BEGIN IMMEDIATE");
  try {
    const result = await work();
    sqlite.exec("COMMIT");
    return result;
  } catch (error) {
    sqlite.exec("ROLLBACK");
    throw error;
  }
}

if (command === "seed") {
  if (!values.reset && (rowCount("Host") > 0 || rowCount("Disk") > 0)) {
    console.error(
      `${databasePath()} already has hosts or disks; pass --reset to replace them`,
    );
    process.exit(1);
  }
  const report = await inTransaction(async () => {
    if (values.reset) deleteAllRows();
    return seed(now);
  });
  if (values.reset) console.log("Deleted every row first");
  console.log(
    `Seeded ${report.instants} replay instants up to ${report.at.toISOString()} in ${report.durationMs} ms, ${report.notifications} story notifications`,
  );
  console.table(report.ingests.count);
  for (const failure of report.failures) console.error(failure);
  printCounts();
  process.exit(report.failures.length === 0 ? 0 : 1);
}

const report = await tick(now);
console.log(
  report.skipped.length > 0
    ? `Already ticked this hour: ${report.skipped.join(", ")}`
    : `Ticked ${report.at.toISOString()}`,
);
console.table(report.ingests.count);
for (const failure of report.failures) console.error(failure);
process.exit(report.failures.length === 0 ? 0 : 1);
