import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import { createDb } from "~~/server/database/client";
import { describeMigrations, runMigrations } from "~~/server/database/migrate";

const TABLES = [
  "CollectorRun",
  "Dataset",
  "DatasetReading",
  "DiaryEntry",
  "Disk",
  "DiskKey",
  "FaultAcceptance",
  "Host",
  "Notification",
  "Payload",
  "Pool",
  "PoolHistory",
  "PoolReading",
  "SelfTest",
  "Setting",
  "SmartAttribute",
  "SmartReading",
  "Snapshot",
  "TemperatureReading",
  "Vdev",
  "VdevReading",
  "ZfsEvent",
];

const MIGRATION_COUNT = 8;

const openConnections: Database.Database[] = [];

function open(path: string) {
  const connection = createDb(path);
  openConnections.push(connection.sqlite);
  return connection;
}

afterEach(() => {
  while (openConnections.length > 0) openConnections.pop()?.close();
});

function temporaryPath(name: string) {
  return join(mkdtempSync(join(tmpdir(), "tetanus-migrate-")), name);
}

function withSqlite<T>(path: string, read: (sqlite: Database.Database) => T) {
  const sqlite = new Database(path);
  try {
    return read(sqlite);
  } finally {
    sqlite.close();
  }
}

function schemaOf(path: string) {
  return withSqlite(path, (sqlite) =>
    (
      sqlite
        .prepare(
          `SELECT sql FROM sqlite_master
           WHERE sql IS NOT NULL
             AND name NOT IN ('__drizzle_migrations')
             AND name NOT LIKE 'sqlite_%'`,
        )
        .raw()
        .all() as [string][]
    )
      .map(([sql]) =>
        sql.replaceAll(/["`]/g, "").replaceAll(/\s+/g, " ").trim(),
      )
      .sort(),
  );
}

function rowCounts(path: string) {
  return withSqlite(path, (sqlite) =>
    Object.fromEntries(
      TABLES.map((table) => [
        table,
        (
          sqlite.prepare(`SELECT count(*) FROM "${table}"`).raw().get() as [
            number,
          ]
        )[0],
      ]),
    ),
  );
}

function drizzleMigrationCount(path: string) {
  return withSqlite(
    path,
    (sqlite) =>
      (
        sqlite
          .prepare(`SELECT count(*) FROM __drizzle_migrations`)
          .raw()
          .get() as [number]
      )[0],
  );
}

describe("runMigrations", () => {
  it("creates every table on a fresh database", () => {
    const { db, sqlite } = open(":memory:");
    const report = runMigrations(sqlite, db);

    expect(report.total).toBe(MIGRATION_COUNT);
    expect(report.applied).toHaveLength(MIGRATION_COUNT);
    expect(report.applied[0]).toBe("0000_setting");

    const tables = (
      sqlite
        .prepare(`SELECT name FROM sqlite_master WHERE type = 'table'`)
        .raw()
        .all() as [string][]
    ).map(([name]) => name);
    for (const table of TABLES) expect(tables).toContain(table);
    expect(
      sqlite.prepare(`SELECT count(*) FROM __drizzle_migrations`).raw().get(),
    ).toEqual([MIGRATION_COUNT]);
  });

  it("is a no-op when run again", () => {
    const path = temporaryPath("twice.sqlite");
    const { db, sqlite } = open(path);
    runMigrations(sqlite, db);
    const schema = schemaOf(path);
    const counts = rowCounts(path);

    const report = runMigrations(sqlite, db);

    expect(report).toMatchObject({ applied: [], total: MIGRATION_COUNT });
    expect(schemaOf(path)).toEqual(schema);
    expect(rowCounts(path)).toEqual(counts);
    expect(drizzleMigrationCount(path)).toBe(MIGRATION_COUNT);
  });
});

describe("describeMigrations", () => {
  it("reports an up-to-date database on one line", () => {
    expect(
      describeMigrations(
        { applied: [], total: 14, durationMs: 1 },
        "/data/tetanus.db",
      ),
    ).toBe(
      "Database up to date, 14 migrations already applied (/data/tetanus.db)",
    );
  });

  it("lists each applied migration", () => {
    expect(
      describeMigrations(
        {
          applied: ["0009_disk_alias", "0010_next"],
          total: 14,
          durationMs: 42,
        },
        "/data/tetanus.db",
      ),
    ).toBe(
      [
        "Database migrated, applied 2 new migrations in 42ms, 14 total (/data/tetanus.db)",
        "  ✔ 0009_disk_alias",
        "  ✔ 0010_next",
      ].join("\n"),
    );
  });
});
