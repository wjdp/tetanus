import { asc, is, sql } from "drizzle-orm";
import { getTableConfig, SQLiteTable } from "drizzle-orm/sqlite-core";
import { db } from "~~/server/database/client";
import * as schema from "~~/server/database/schema";
import { simulation, simulationChange } from "~~/server/database/schema";

const TRIGGER_PREFIX = "simulation_capture_";
const OPS = ["insert", "update", "delete"] as const;

interface CapturedTable {
  name: string;
  columns: string[];
  /** Has an INTEGER PRIMARY KEY, so the column is the rowid and a reinsert restores it. */
  rowidIsColumn: boolean;
}

const quote = (identifier: string) => `"${identifier.replaceAll('"', '""')}"`;
const literal = (value: string) => `'${value.replaceAll("'", "''")}'`;

const UNCAPTURED = new Set<string>([
  getTableConfig(simulation).name,
  getTableConfig(simulationChange).name,
]);

export function schemaTables(): SQLiteTable[] {
  return (Object.values(schema) as unknown[]).filter(
    (value): value is SQLiteTable => is(value, SQLiteTable),
  );
}

function capturedTables(): CapturedTable[] {
  return schemaTables()
    .map((table) => getTableConfig(table))
    .filter((config) => !UNCAPTURED.has(config.name))
    .map((config) => ({
      name: config.name,
      columns: config.columns.map((column) => column.name),
      rowidIsColumn: config.columns.some(
        (column) => column.primary && column.getSQLType() === "integer",
      ),
    }));
}

function image(table: CapturedTable, row: "NEW" | "OLD") {
  const pairs = table.columns.map(
    (column) => `${literal(column)}, ${row}.${quote(column)}`,
  );
  return `json_object(${pairs.join(", ")})`;
}

function triggerName(table: CapturedTable, op: (typeof OPS)[number]) {
  return quote(`${TRIGGER_PREFIX}${table.name}_${op}`);
}

function createTriggerSql(table: CapturedTable, op: (typeof OPS)[number]) {
  const row = op === "delete" ? "OLD" : "NEW";
  const before = op === "insert" ? "NULL" : image(table, "OLD");
  const after = op === "delete" ? "NULL" : image(table, "NEW");
  return `CREATE TRIGGER IF NOT EXISTS ${triggerName(table, op)} AFTER ${op.toUpperCase()} ON ${quote(table.name)} BEGIN
  INSERT INTO "SimulationChange" ("tableName", "op", "rowId", "before", "after")
  VALUES (${literal(table.name)}, ${literal(op)}, ${row}.rowid, ${before}, ${after});
END`;
}

/** Starts logging every write to every table; idempotent. */
export function startCapture() {
  for (const table of capturedTables()) {
    for (const op of OPS) db.run(sql.raw(createTriggerSql(table, op)));
  }
}

function stopCapture() {
  const triggers = db.all<{ name: string }>(
    sql`SELECT name FROM sqlite_master WHERE type = 'trigger' AND name LIKE ${`${TRIGGER_PREFIX}%`}`,
  );
  for (const { name } of triggers) {
    db.run(sql.raw(`DROP TRIGGER IF EXISTS ${quote(name)}`));
  }
}

function extracted(column: string, imageJson: string) {
  return sql`json_extract(${imageJson}, ${`$.${JSON.stringify(column)}`})`;
}

function undoChange(
  table: CapturedTable,
  change: typeof simulationChange.$inferSelect,
) {
  const target = sql.raw(quote(table.name));
  if (change.op === "insert") {
    db.run(sql`DELETE FROM ${target} WHERE rowid = ${change.rowId}`);
    return;
  }
  const before = change.before ?? "{}";
  if (change.op === "update") {
    const assignments = table.columns.map(
      (column) => sql`${sql.raw(quote(column))} = ${extracted(column, before)}`,
    );
    db.run(
      sql`UPDATE ${target} SET ${sql.join(assignments, sql`, `)} WHERE rowid = ${change.rowId}`,
    );
    return;
  }
  const columns = table.rowidIsColumn
    ? table.columns
    : ["rowid", ...table.columns];
  const values = columns.map((column) =>
    column === "rowid" ? sql`${change.rowId}` : extracted(column, before),
  );
  db.run(
    sql`INSERT INTO ${target} (${sql.raw(columns.map(quote).join(", "))}) VALUES (${sql.join(values, sql`, `)})`,
  );
}

/** Stops logging and reverts every logged write, newest first; returns how many it reverted. */
export function rollBackCapture(): number {
  const tables = new Map(capturedTables().map((table) => [table.name, table]));
  return db.transaction(() => {
    stopCapture();
    db.run(sql`PRAGMA defer_foreign_keys = ON`);
    const changes = db
      .select()
      .from(simulationChange)
      .orderBy(asc(simulationChange.id))
      .all()
      .reverse();
    for (const change of changes) {
      const table = tables.get(change.tableName);
      if (!table) {
        throw new Error(
          `Cannot undo a write to unknown table ${change.tableName}`,
        );
      }
      undoChange(table, change);
    }
    db.delete(simulationChange).run();
    db.delete(simulation).run();
    return changes.length;
  });
}
