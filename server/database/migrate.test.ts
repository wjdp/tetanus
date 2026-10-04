import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import { createDb } from "~~/server/database/client";
import { describeMigrations, runMigrations } from "~~/server/database/migrate";

const TABLES = [
  "Bay",
  "CollectorRun",
  "Dataset",
  "DatasetReading",
  "DiaryEntry",
  "Disk",
  "DiskKey",
  "Enclosure",
  "Fault",
  "FaultAcceptance",
  "Host",
  "Notification",
  "Payload",
  "Pool",
  "PoolHistory",
  "PoolReading",
  "Replication",
  "ReplicationSync",
  "SelfTest",
  "Setting",
  "Simulation",
  "SimulationChange",
  "SmartAttribute",
  "SmartReading",
  "Snapshot",
  "TemperatureReading",
  "Vdev",
  "VdevReading",
  "ZfsEvent",
];

const MIGRATION_COUNT = 26;

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

describe("0009_host_collector_version", () => {
  it("renames scan-errors faults, their diary trail and notifications", () => {
    const { db, sqlite } = open(":memory:");
    runMigrations(sqlite, db);
    sqlite.exec(`
      ALTER TABLE Pool DROP COLUMN scanProgressAt;
      ALTER TABLE Pool DROP COLUMN archivedAt;
      ALTER TABLE Pool DROP COLUMN archiveNote;
      DROP INDEX Disk_replacesDiskId_key;
      ALTER TABLE Disk DROP COLUMN disposal;
      ALTER TABLE Disk DROP COLUMN replacesDiskId;
      ALTER TABLE Disk DROP COLUMN ataSsdAttributes;
      DROP TABLE ReplicationSync;
      DROP TABLE Replication;
      DROP TABLE Bay;
      DROP TABLE Enclosure;
      ALTER TABLE Disk DROP COLUMN lastIdPath;
      ALTER TABLE Disk DROP COLUMN lastSlot;
      ALTER TABLE Disk DROP COLUMN lastLocationKey;
      DELETE FROM __drizzle_migrations
        WHERE created_at IN (
          SELECT created_at FROM __drizzle_migrations
            ORDER BY created_at DESC LIMIT 9
        );
      INSERT INTO Fault (kind, category, subjectType, subjectId, key, severity,
                         data, openedAt, lastSeenAt, state, stateChangedAt)
        VALUES ('scan-errors', 'zfs', 'pool', 1, '1', 'error',
                '{"poolName":"tank","function":"SCRUB","errors":2}',
                0, 0, 'open', 0);
      INSERT INTO DiaryEntry (subjectType, subjectId, at, kind, eventType, title, data)
        VALUES ('pool', 1, 0, 'auto', 'fault-opened', 'fault',
                '{"faultId":1,"kind":"scan-errors","key":"1"}');
      INSERT INTO Notification (at, channel, rule, dedupeKey, subject, title, message, ok)
        VALUES (0, 'webhook', 'scan-errors', 'k', 's', 't', 'm', 1);
    `);

    expect(runMigrations(sqlite, db).applied).toEqual([
      "0017_fault_kind_pool_data_errors",
      "0018_vdev_role_backfill",
      "0019_pool_scan_progress",
      "0020_pool_archive",
      "0021_disk_ata_ssd_attributes",
      "0022_disk_disposal",
      "0023_guid_saturation_and_unattributed_history",
      "0024_replication",
      "0025_bay_mapping",
    ]);
    const row = sqlite.prepare("SELECT kind, data FROM Fault").get() as {
      kind: string;
      data: string;
    };
    expect(row.kind).toBe("pool-data-errors");
    expect(JSON.parse(row.data)).toMatchObject({
      scanErrors: 2,
      dataErrors: 0,
    });
    expect(
      JSON.parse(
        (
          sqlite.prepare("SELECT data FROM DiaryEntry").get() as {
            data: string;
          }
        ).data,
      ).kind,
    ).toBe("pool-data-errors");
    expect(sqlite.prepare("SELECT rule FROM Notification").get()).toEqual({
      rule: "pool-data-errors",
    });
  });

  it("backfills each host's latest versioned collector", () => {
    const { db, sqlite } = open(":memory:");
    runMigrations(sqlite, db);
    sqlite.exec(`
      ALTER TABLE Host DROP COLUMN intermittent;
      ALTER TABLE Host DROP COLUMN position;
      ALTER TABLE Host DROP COLUMN temperatureThresholds;
      ALTER TABLE Host DROP COLUMN collectorVersion;
      ALTER TABLE Host DROP COLUMN collectorStatus;
      ALTER TABLE FaultAcceptance DROP COLUMN kind;
      DROP TABLE Fault;
      DROP TABLE Simulation;
      DROP TABLE SimulationChange;
      ALTER TABLE Pool DROP COLUMN msgid;
      ALTER TABLE Pool DROP COLUMN moreinfo;
      ALTER TABLE Pool DROP COLUMN damagedFiles;
      ALTER TABLE Pool DROP COLUMN damagedFilesError;
      ALTER TABLE Pool DROP COLUMN lastScrub;
      ALTER TABLE Pool DROP COLUMN removal;
      ALTER TABLE Pool DROP COLUMN config;
      ALTER TABLE Pool DROP COLUMN scanProgressAt;
      ALTER TABLE Pool DROP COLUMN archivedAt;
      ALTER TABLE Pool DROP COLUMN archiveNote;
      DROP INDEX Disk_replacesDiskId_key;
      ALTER TABLE Disk DROP COLUMN disposal;
      ALTER TABLE Disk DROP COLUMN replacesDiskId;
      ALTER TABLE Disk DROP COLUMN ataSsdAttributes;
      ALTER TABLE Vdev DROP COLUMN role;
      ALTER TABLE Vdev DROP COLUMN spareState;
      DROP TABLE ReplicationSync;
      DROP TABLE Replication;
      DROP TABLE Bay;
      DROP TABLE Enclosure;
      ALTER TABLE Disk DROP COLUMN lastIdPath;
      ALTER TABLE Disk DROP COLUMN lastSlot;
      ALTER TABLE Disk DROP COLUMN lastLocationKey;
      DELETE FROM __drizzle_migrations
        WHERE created_at IN (
          SELECT created_at FROM __drizzle_migrations
            ORDER BY created_at DESC LIMIT 17
        );
      INSERT INTO Host (id, name, firstSeenAt, lastSeenAt)
        VALUES (1, 'mars', 0, 0), (2, 'pihost', 0, 0), (3, 'venus', 0, 0);
      INSERT INTO CollectorRun (hostId, source, receivedAt, ok, bytes, producer)
        VALUES (1, 'versions', 0, 1, 0, 'tetanus-collect/0.2.0'),
               (1, 'versions', 0, 1, 0, 'tetanus-collect/0.3.0'),
               (1, 'zed-event', 0, 1, 0, 'tetanus-zed'),
               (2, 'versions', 0, 1, 0, 'tetanus-collect/1'),
               (3, 'versions', 0, 1, 0, NULL);
    `);

    expect(runMigrations(sqlite, db).applied).toEqual([
      "0009_host_collector_version",
      "0010_host_temperature_thresholds",
      "0011_host_intermittent_and_position",
      "0012_fault_acceptance_kind",
      "0013_fault",
      "0014_simulation",
      "0015_pool_scrub_config_removal",
      "0016_vdev_role_spare_state",
      "0017_fault_kind_pool_data_errors",
      "0018_vdev_role_backfill",
      "0019_pool_scan_progress",
      "0020_pool_archive",
      "0021_disk_ata_ssd_attributes",
      "0022_disk_disposal",
      "0023_guid_saturation_and_unattributed_history",
      "0024_replication",
      "0025_bay_mapping",
    ]);
    expect(
      sqlite
        .prepare(
          "SELECT name, collectorVersion, collectorStatus FROM Host ORDER BY id",
        )
        .all(),
    ).toEqual([
      { name: "mars", collectorVersion: "0.3.0", collectorStatus: "unknown" },
      { name: "pihost", collectorVersion: null, collectorStatus: "unknown" },
      { name: "venus", collectorVersion: null, collectorStatus: "unknown" },
    ]);
  });
});

describe("0018_vdev_role_backfill", () => {
  it("gives leaves their group's role and fixes single log and cache leaves", () => {
    const { db, sqlite } = open(":memory:");
    runMigrations(sqlite, db);
    sqlite.exec(`
      ALTER TABLE Pool DROP COLUMN scanProgressAt;
      ALTER TABLE Pool DROP COLUMN archivedAt;
      ALTER TABLE Pool DROP COLUMN archiveNote;
      DROP INDEX Disk_replacesDiskId_key;
      ALTER TABLE Disk DROP COLUMN disposal;
      ALTER TABLE Disk DROP COLUMN replacesDiskId;
      ALTER TABLE Disk DROP COLUMN ataSsdAttributes;
      DROP TABLE ReplicationSync;
      DROP TABLE Replication;
      DROP TABLE Bay;
      DROP TABLE Enclosure;
      ALTER TABLE Disk DROP COLUMN lastIdPath;
      ALTER TABLE Disk DROP COLUMN lastSlot;
      ALTER TABLE Disk DROP COLUMN lastLocationKey;
      DELETE FROM __drizzle_migrations
        WHERE created_at IN (
          SELECT created_at FROM __drizzle_migrations
            ORDER BY created_at DESC LIMIT 8
        );
      INSERT INTO Host (id, name, firstSeenAt, lastSeenAt) VALUES (1, 'mars', 0, 0);
      INSERT INTO Pool (id, hostId, guid, name, state, firstSeenAt, lastSeenAt)
        VALUES (1, 1, 'p', 'tank', 'ONLINE', 0, 0);
      INSERT INTO Vdev (id, poolId, guid, parentId, name, type, role, state, path, present, lastSeenAt)
        VALUES (1, 1, 'root', NULL, 'tank', 'root', 'normal', 'ONLINE', NULL, 1, 0),
               (2, 1, 'mirror', 1, 'mirror-4', 'special', 'special', 'ONLINE', NULL, 1, 0),
               (3, 1, 'sa', 2, 'S1', 'disk', 'normal', 'ONLINE', '/dev/disk/by-vdev/S1', 0, 0),
               (4, 1, 'sb', 2, 'S2', 'disk', 'normal', 'ONLINE', '/dev/disk/by-vdev/S2', 1, 0),
               (5, 1, 'log', 1, 'L1', 'log', 'normal', 'ONLINE', '/dev/disk/by-vdev/L1', 0, 0),
               (6, 1, 'logfile', 1, '/tmp/log.img', 'log', 'log', 'ONLINE', '/tmp/log.img', 1, 0),
               (7, 1, 'nopath', 1, 'L2', 'log', 'log', 'ONLINE', NULL, 0, 0),
               (8, 1, 'data', 1, 'A1', 'disk', 'normal', 'ONLINE', '/dev/disk/by-vdev/A1', 1, 0);
    `);

    expect(runMigrations(sqlite, db).applied).toEqual([
      "0018_vdev_role_backfill",
      "0019_pool_scan_progress",
      "0020_pool_archive",
      "0021_disk_ata_ssd_attributes",
      "0022_disk_disposal",
      "0023_guid_saturation_and_unattributed_history",
      "0024_replication",
      "0025_bay_mapping",
    ]);
    expect(
      sqlite.prepare("SELECT guid, type, role FROM Vdev ORDER BY id").all(),
    ).toEqual([
      { guid: "root", type: "root", role: "normal" },
      { guid: "mirror", type: "special", role: "special" },
      { guid: "sa", type: "disk", role: "special" },
      { guid: "sb", type: "disk", role: "special" },
      { guid: "log", type: "disk", role: "log" },
      { guid: "logfile", type: "file", role: "log" },
      { guid: "nopath", type: "log", role: "log" },
      { guid: "data", type: "disk", role: "normal" },
    ]);
  });
});

describe("0022_disk_disposal", () => {
  it("moves sold overrides to a sold disposal dated by the diary", () => {
    const { db, sqlite } = open(":memory:");
    runMigrations(sqlite, db);
    sqlite.exec(`
      DROP INDEX Disk_replacesDiskId_key;
      ALTER TABLE Disk DROP COLUMN disposal;
      ALTER TABLE Disk DROP COLUMN replacesDiskId;
      DROP TABLE ReplicationSync;
      DROP TABLE Replication;
      DROP TABLE Bay;
      DROP TABLE Enclosure;
      ALTER TABLE Disk DROP COLUMN lastIdPath;
      ALTER TABLE Disk DROP COLUMN lastSlot;
      ALTER TABLE Disk DROP COLUMN lastLocationKey;
      DELETE FROM __drizzle_migrations
        WHERE created_at IN (
          SELECT created_at FROM __drizzle_migrations
            ORDER BY created_at DESC LIMIT 4
        );
      INSERT INTO Disk (id, stateOverride, lastState)
        VALUES (1, 'sold', 'sold'), (2, 'sold', 'sold'), (3, 'dead', 'dead');
      INSERT INTO DiaryEntry (subjectType, subjectId, at, kind, eventType, title, data)
        VALUES ('disk', 1, ${Date.parse("2026-03-01T12:00:00Z")}, 'auto', 'override-set', 'x',
                '{"from":null,"to":"sold"}'),
               ('disk', 1, ${Date.parse("2026-04-02T12:00:00Z")}, 'auto', 'override-set', 'x',
                '{"from":null,"to":"sold"}'),
               ('disk', 1, ${Date.parse("2026-05-01T12:00:00Z")}, 'auto', 'override-set', 'x',
                '{"from":null,"to":"dead"}'),
               ('disk', 2, ${Date.parse("2026-05-01T12:00:00Z")}, 'auto', 'state-changed', 'x',
                '{"from":"spare","to":"sold"}');
    `);

    expect(runMigrations(sqlite, db).applied).toEqual([
      "0022_disk_disposal",
      "0023_guid_saturation_and_unattributed_history",
      "0024_replication",
      "0025_bay_mapping",
    ]);
    const today = new Date().toISOString().slice(0, 10);
    expect(
      (
        sqlite
          .prepare(
            "SELECT id, stateOverride, lastState, disposal, replacesDiskId FROM Disk ORDER BY id",
          )
          .all() as { disposal: string | null }[]
      ).map((row) => ({
        ...row,
        disposal: row.disposal && JSON.parse(row.disposal),
      })),
    ).toEqual([
      {
        id: 1,
        stateOverride: null,
        lastState: null,
        disposal: { kind: "sold", on: "2026-04-02" },
        replacesDiskId: null,
      },
      {
        id: 2,
        stateOverride: null,
        lastState: null,
        disposal: { kind: "sold", on: today },
        replacesDiskId: null,
      },
      {
        id: 3,
        stateOverride: "dead",
        lastState: "dead",
        disposal: null,
        replacesDiskId: null,
      },
    ]);
  });
});

describe("0023_guid_saturation_and_unattributed_history", () => {
  it("nulls saturated snapshot guids and drops history with no pool", () => {
    const { db, sqlite } = open(":memory:");
    runMigrations(sqlite, db);
    sqlite.exec(`
      DROP TABLE ReplicationSync;
      DROP TABLE Replication;
      DROP TABLE Bay;
      DROP TABLE Enclosure;
      ALTER TABLE Disk DROP COLUMN lastIdPath;
      ALTER TABLE Disk DROP COLUMN lastSlot;
      ALTER TABLE Disk DROP COLUMN lastLocationKey;
      DELETE FROM __drizzle_migrations
        WHERE created_at IN (
          SELECT created_at FROM __drizzle_migrations
            ORDER BY created_at DESC LIMIT 3
        );
      INSERT INTO Host (name, firstSeenAt, lastSeenAt) VALUES ('mars', 0, 0);
      INSERT INTO Pool (hostId, guid, name, state, firstSeenAt, lastSeenAt)
        VALUES (1, '1', 'tank', 'ONLINE', 0, 0);
      INSERT INTO Dataset (poolId, name, type, used, referenced, available, creation,
                           firstSeenAt, lastSeenAt)
        VALUES (1, 'tank', 'filesystem', 0, 0, 0, 0, 0, 0);
      INSERT INTO Snapshot (datasetId, name, guid, used, referenced, written, creation,
                            lastSeenAt)
        VALUES (1, 'a', '9223372036854775807', 0, 0, 0, 0, 0),
               (1, 'b', '18101820395123456789', 0, 0, 0, 0, 0);
      INSERT INTO PoolHistory (hostId, poolId, at, internal, text)
        VALUES (1, NULL, 0, 0, 'unattributed'), (1, 1, 0, 0, 'attributed');
    `);

    expect(runMigrations(sqlite, db).applied).toEqual([
      "0023_guid_saturation_and_unattributed_history",
      "0024_replication",
      "0025_bay_mapping",
    ]);
    expect(
      sqlite.prepare("SELECT name, guid FROM Snapshot ORDER BY name").all(),
    ).toEqual([
      { name: "a", guid: null },
      { name: "b", guid: "18101820395123456789" },
    ]);
    expect(sqlite.prepare("SELECT text FROM PoolHistory").all()).toEqual([
      { text: "attributed" },
    ]);
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
