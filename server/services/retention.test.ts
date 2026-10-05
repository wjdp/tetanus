import { beforeEach, describe, expect, it } from "vitest";
import { sqlite } from "~~/server/database/client";
import { parse as parseZpoolHistory } from "~~/server/ingest/zpool-history";
import { recordIngest } from "~~/server/services/ingest";
import { flushDb } from "~~/test/db";
import { readFixture } from "~~/test/fixtures";
import { pruneDatabase, reclaimSpace } from "./retention";

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const NOW = new Date("2026-10-05T12:00:00Z");
const daysAgo = (days: number, plusHours = 0) =>
  NOW.getTime() - days * DAY_MS + plusHours * HOUR_MS;
const startOfDay = (ms: number) => ms - (ms % DAY_MS);

function insert(table: string, row: Record<string, unknown>): number {
  const columns = Object.keys(row);
  const values =
    columns.length === 0
      ? "DEFAULT VALUES"
      : `(${columns.join(", ")}) VALUES (${columns.map((column) => `@${column}`).join(", ")})`;
  return Number(
    sqlite.prepare(`INSERT INTO ${table} ${values}`).run(row).lastInsertRowid,
  );
}

function ids(table: string, where = "1"): number[] {
  return (
    sqlite
      .prepare(`SELECT id FROM ${table} WHERE ${where} ORDER BY id`)
      .all() as {
      id: number;
    }[]
  ).map((row) => row.id);
}

let hostId: number;
let poolId: number;
let diskId: number;

beforeEach(() => {
  flushDb();
  hostId = insert("Host", { name: "host", firstSeenAt: 0, lastSeenAt: 0 });
  poolId = insert("Pool", {
    hostId,
    guid: "1",
    name: "tank",
    state: "ONLINE",
    firstSeenAt: 0,
    lastSeenAt: 0,
  });
  diskId = insert("Disk", {});
});

function historyEvent(eid: number | null, at: number) {
  return insert("ZfsEvent", {
    hostId,
    eid,
    at,
    class: "sysevent.fs.zfs.history_event",
    payload: "{}",
  });
}

describe("history events", () => {
  it("prunes old events below the kernel buffer, keeping the anchor below it", async () => {
    sqlite
      .prepare("UPDATE Host SET zpoolEventsOldestEid = 10 WHERE id = ?")
      .run(hostId);
    const belowAnchor = historyEvent(8, daysAgo(5));
    const anchor = historyEvent(9, daysAgo(5));
    const inBuffer = historyEvent(10, daysAgo(5));
    const recent = historyEvent(5, daysAgo(1));
    const archived = historyEvent(null, daysAgo(5));
    const ereport = insert("ZfsEvent", {
      hostId,
      eid: 3,
      at: daysAgo(500),
      class: "ereport.fs.zfs.checksum",
      payload: "{}",
    });

    await pruneDatabase(NOW);

    expect(ids("ZfsEvent")).toEqual([anchor, inBuffer, recent, ereport]);
    expect(ids("ZfsEvent")).not.toContain(belowAnchor);
    expect(ids("ZfsEvent")).not.toContain(archived);
  });

  it("keeps numbered events while the host has never sent a dump", async () => {
    const event = historyEvent(1, daysAgo(5));
    await pruneDatabase(NOW);
    expect(ids("ZfsEvent")).toEqual([event]);
  });
});

describe("collector runs", () => {
  const run = (
    source: string,
    receivedAt: number,
    device: string | null = null,
  ) =>
    insert("CollectorRun", {
      hostId,
      source,
      device,
      receivedAt,
      ok: 1,
      bytes: 0,
    });

  it("prunes old runs but keeps the newest per source and device", async () => {
    run("lsblk", daysAgo(40));
    const lastLsblk = run("lsblk", daysAgo(35));
    run("smartctl-xall", daysAgo(40), "/dev/sda");
    const recentSda = run("smartctl-xall", daysAgo(1), "/dev/sda");
    const lastSdb = run("smartctl-xall", daysAgo(40), "/dev/sdb");

    await pruneDatabase(NOW);

    expect(ids("CollectorRun")).toEqual([lastLsblk, recentSda, lastSdb]);
  });
});

describe("pool history", () => {
  const line = (text: string, at: number, internal = 0) =>
    insert("PoolHistory", { hostId, poolId, at, internal, text });

  it("prunes routine lines past 14 days and keeps the rest forever", async () => {
    line("zfs snapshot tank/a@autosnap_hourly", daysAgo(20));
    line("destroy tank/a@autosnap_hourly (12)", daysAgo(20), 1);
    const create = line("zfs create tank/a", daysAgo(20));
    const recent = line("zfs snapshot tank/a@autosnap_hourly", daysAgo(3));

    await pruneDatabase(NOW);

    expect(ids("PoolHistory")).toEqual([create, recent]);
  });
});

describe("readings", () => {
  it("collapses dataset readings past 90 days to the last of each day", async () => {
    const datasetId = insert("Dataset", {
      poolId,
      name: "tank",
      type: "filesystem",
      used: 0,
      referenced: 0,
      available: 0,
      creation: 0,
      firstSeenAt: 0,
      lastSeenAt: 0,
    });
    const reading = (at: number) =>
      insert("DatasetReading", { datasetId, at, used: 0 });
    const day = startOfDay(daysAgo(100));
    reading(day + HOUR_MS);
    const lastOfDay = reading(day + 20 * HOUR_MS);
    const nextDay = reading(day + DAY_MS + HOUR_MS);
    const recentDay = startOfDay(daysAgo(10));
    const recentA = reading(recentDay + HOUR_MS);
    const recentB = reading(recentDay + 2 * HOUR_MS);

    await pruneDatabase(NOW);

    expect(ids("DatasetReading")).toEqual([
      lastOfDay,
      nextDay,
      recentA,
      recentB,
    ]);
  });

  it("collapses pool readings past 30 days", async () => {
    const reading = (at: number) =>
      insert("PoolReading", { poolId, at, state: "ONLINE" });
    const day = startOfDay(daysAgo(40));
    reading(day + HOUR_MS);
    const kept = reading(day + 2 * HOUR_MS);

    await pruneDatabase(NOW);

    expect(ids("PoolReading")).toEqual([kept]);
  });

  it("collapses SMART readings past 30 days with their attributes", async () => {
    const reading = (takenAt: number) => {
      const readingId = insert("SmartReading", {
        diskId,
        hostId,
        takenAt,
        devicePath: "/dev/sda",
        deviceStatus: "passed",
      });
      insert("SmartAttribute", {
        readingId,
        diskId,
        takenAt,
        attrId: "5",
        name: "Reallocated_Sector_Ct",
        transformedValue: 0,
        status: "passed",
      });
      return readingId;
    };
    const day = startOfDay(daysAgo(40));
    reading(day + HOUR_MS);
    const kept = reading(day + 23 * HOUR_MS);

    await pruneDatabase(NOW);

    expect(ids("SmartReading")).toEqual([kept]);
    expect(
      sqlite.prepare("SELECT readingId FROM SmartAttribute").pluck().all(),
    ).toEqual([kept]);
  });

  it("keeps each hour's maximum temperature past 30 days and each day's range past a year", async () => {
    const temperature = (at: number, celsius: number) =>
      insert("TemperatureReading", { diskId, at, celsius });
    const hour = startOfDay(daysAgo(40));
    temperature(hour, 30);
    const hourMax = temperature(hour + 10 * 60_000, 35);
    temperature(hour + 20 * 60_000, 32);
    const day = startOfDay(daysAgo(400));
    const dayMin = temperature(day + HOUR_MS, 25);
    temperature(day + 2 * HOUR_MS, 30);
    const dayMax = temperature(day + 3 * HOUR_MS, 40);
    temperature(day + 4 * HOUR_MS, 28);
    const recent = temperature(daysAgo(1), 31);
    const recentToo = temperature(daysAgo(1, 1), 30);

    await pruneDatabase(NOW);

    expect(ids("TemperatureReading")).toEqual([
      hourMax,
      dayMin,
      dayMax,
      recent,
      recentToo,
    ]);
  });
});

it("is not undone by the collector resending what it pruned", async () => {
  const history = readFixture("mars/zpool-history.txt");
  const events = readFixture("mars/zpool-events.txt");
  const newest = Math.max(
    ...parseZpoolHistory(history, {}).data.entries.map((entry) =>
      Date.parse(entry.at),
    ),
  );
  const ingest = (receivedAt: Date) => {
    for (const [source, body] of [
      ["zpool-history", history],
      ["zfs-receives", history],
      ["zpool-events", events],
    ] as const) {
      const outcome = recordIngest({
        hostName: "mars",
        source,
        meta: {},
        body,
        receivedAt,
      });
      expect(outcome.ok).toBe(true);
    }
  };
  const rows = () => ({
    history: ids("PoolHistory").length,
    events: ids("ZfsEvent").length,
  });
  ingest(new Date(newest));
  const ingested = rows();
  const later = new Date(newest + 20 * DAY_MS);
  await pruneDatabase(later);
  const pruned = rows();
  expect(pruned.history).toBeLessThan(ingested.history);

  ingest(later);

  expect(rows()).toEqual(pruned);
});

it("deletes nothing on a second run", async () => {
  insert("PoolReading", { poolId, at: daysAgo(40), state: "ONLINE" });
  insert("PoolReading", { poolId, at: daysAgo(40, 1), state: "ONLINE" });
  await pruneDatabase(NOW);
  const counts = await pruneDatabase(NOW);
  expect(Object.values(counts).every((count) => count === 0)).toBe(true);
});

it("switches to incremental auto-vacuum once", () => {
  expect(reclaimSpace()).toBe("vacuumed");
  expect(reclaimSpace()).toBe("incremental");
});
