import { readdirSync } from "node:fs";
import { join } from "node:path";
import { eq, isNotNull } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "~~/server/database/client";
import {
  diaryEntry,
  pool,
  poolHistory,
  poolReading,
  vdev,
  vdevReading,
  zfsEvent,
} from "~~/server/database/schema";
import type { IngestContext } from "~~/server/ingest/handlers";
import { parse as parseZedEvent } from "~~/server/ingest/zed-event";
import type { ZfsEvent } from "~~/server/ingest/zfsEvent";
import { parse as parseZpoolEvents } from "~~/server/ingest/zpool-events";
import { parse as parseZpoolHistory } from "~~/server/ingest/zpool-history";
import { parse as parseZpoolList } from "~~/server/ingest/zpool-list";
import {
  parse as parseZpoolStatus,
  type ZpoolStatusResult,
} from "~~/server/ingest/zpool-status";
import { upsertHostByName } from "~~/server/services/hosts";
import { recordIngest } from "~~/server/services/ingest";
import {
  getPool,
  listPools,
  type VdevNode,
  ZFS_HANDLERS,
} from "~~/server/services/zfs";
import { flushDb } from "~~/test/db";
import { readFixture } from "~~/test/fixtures";

const T0 = new Date("2026-09-28T17:00:00Z");
const TANK_GUID = "4620770592528249368";
const K1_GUID = "615499781187199551";
const UDEV_DIR = join(import.meta.dirname, "../../test/fixtures/mars/udev");

function minutesAfter(minutes: number) {
  return new Date(T0.getTime() + minutes * 60_000);
}

function marsStatus(): ZpoolStatusResult {
  return parseZpoolStatus(
    readFixture("mars/zpool-status-stored-paths.json"),
    {},
  ).data;
}

function run<T>(
  source: keyof typeof ZFS_HANDLERS,
  data: T,
  receivedAt = T0,
  hostName = "mars",
) {
  const hostRow = upsertHostByName(hostName, receivedAt);
  const context: IngestContext<T> = {
    hostId: hostRow.id,
    hostName: hostRow.name,
    receivedAt,
    meta: {},
    data,
    body: "",
  };
  db.transaction(() => ZFS_HANDLERS[source]?.(context));
  return hostRow.id;
}

function tank(status: ZpoolStatusResult) {
  const found = status.pools.find((candidate) => candidate.name === "tank");
  if (!found) throw new Error("tank missing from fixture");
  return found;
}

function vdevNamed(status: ZpoolStatusResult, name: string) {
  const found = tank(status).vdevs.find((candidate) => candidate.name === name);
  if (!found) throw new Error(`${name} missing from fixture`);
  return found;
}

function diary(eventType?: string) {
  return db
    .select()
    .from(diaryEntry)
    .orderBy(diaryEntry.id)
    .all()
    .filter(
      (entry) => eventType === undefined || entry.eventType === eventType,
    );
}

function vdevRow(guid: string) {
  const row = db.select().from(vdev).where(eq(vdev.guid, guid)).get();
  if (!row) throw new Error(`vdev ${guid} not stored`);
  return row;
}

function snapshot() {
  return {
    pools: db.select().from(pool).orderBy(pool.id).all(),
    vdevs: db.select().from(vdev).orderBy(vdev.id).all(),
    vdevReadings: db.select().from(vdevReading).all().length,
    diary: diary(),
  };
}

function ingest(source: string, body: string, device?: string) {
  const outcome = recordIngest({
    hostName: "mars",
    source,
    meta: device ? { device } : {},
    body,
    receivedAt: T0,
  });
  expect(outcome.ok).toBe(true);
}

function ingestMarsDisks() {
  ingest("lsblk", readFixture("mars/lsblk.json"));
  for (const file of readdirSync(UDEV_DIR).filter((name) =>
    name.endsWith(".txt"),
  )) {
    const name = file.replace(/\.txt$/, "");
    ingest(
      "udev",
      readFixture(`mars/udev/${file}`),
      name.slice(1).replace("-", ":"),
    );
  }
  ingest("vdev-id-conf", readFixture("mars/vdev-id-conf.txt"));
}

function flatten(node: VdevNode | null): VdevNode[] {
  return node ? [node, ...node.children.flatMap(flatten)] : [];
}

beforeEach(() => {
  flushDb();
});

describe("zpool-status", () => {
  it("stores both mars pools and their vdev tree", () => {
    run("zpool-status", marsStatus());

    const pools = db.select().from(pool).orderBy(pool.name).all();
    expect(pools.map((row) => row.name)).toEqual(["tank", "zeta"]);
    expect(pools[0]).toMatchObject({
      guid: TANK_GUID,
      state: "ONLINE",
      errors: 0,
      firstSeenAt: T0,
      scan: { function: "SCRUB", state: "FINISHED", endTime: 1789325257 },
    });

    const k1 = vdevRow(K1_GUID);
    const raidz = vdevRow("11092505927246116873");
    const root = vdevRow(TANK_GUID);
    expect(k1).toMatchObject({
      name: "/dev/disk/by-vdev/K1-part1",
      type: "disk",
      parentId: raidz.id,
      devid: "scsi-35000cca5f853b4e6-part1",
      present: true,
    });
    expect(raidz.parentId).toBe(root.id);
    expect(root.parentId).toBeNull();
    expect(db.select().from(vdev).all()).toHaveLength(25);
  });

  it("is idempotent and seeds no diary on first sight", () => {
    run("zpool-status", marsStatus());
    const first = snapshot();
    run("zpool-status", marsStatus(), minutesAfter(10));
    const second = snapshot();

    expect(first.diary).toEqual([]);
    expect(second.diary).toEqual([]);
    expect(second.pools.map((row) => row.id)).toEqual(
      first.pools.map((row) => row.id),
    );
    expect(second.vdevs.map((row) => [row.id, row.parentId])).toEqual(
      first.vdevs.map((row) => [row.id, row.parentId]),
    );
    expect(second.vdevReadings).toBe(first.vdevReadings);
    expect(first.vdevReadings).toBe(25);
    expect(db.select().from(poolReading).all()).toHaveLength(4);
  });

  it("records a vdev leaving once and rejoining", () => {
    run("zpool-status", marsStatus());
    const without = marsStatus();
    tank(without).vdevs = tank(without).vdevs.filter(
      (candidate) => candidate.guid !== K1_GUID,
    );

    run("zpool-status", without, minutesAfter(10));
    run("zpool-status", without, minutesAfter(20));
    expect(vdevRow(K1_GUID).present).toBe(false);
    expect(diary("vdev-left")).toMatchObject([
      {
        subjectType: "vdev",
        subjectId: vdevRow(K1_GUID).id,
        title: "/dev/disk/by-vdev/K1-part1 left tank",
      },
    ]);

    run("zpool-status", marsStatus(), minutesAfter(30));
    expect(vdevRow(K1_GUID).present).toBe(true);
    expect(diary("vdev-joined")).toMatchObject([
      { subjectId: vdevRow(K1_GUID).id, data: { rejoined: true } },
    ]);
  });

  it("records a new vdev joining an existing pool", () => {
    run("zpool-status", marsStatus());
    const grown = marsStatus();
    const k1 = vdevNamed(grown, "/dev/disk/by-vdev/K1-part1");
    tank(grown).vdevs.push({
      ...k1,
      guid: "1",
      name: "/dev/disk/by-vdev/K9-part1",
      path: "/dev/disk/by-vdev/K9-part1",
    });

    run("zpool-status", grown, minutesAfter(10));
    const joined = diary("vdev-joined");
    expect(joined).toHaveLength(1);
    expect(joined[0]).toMatchObject({
      subjectId: vdevRow("1").id,
      title: "/dev/disk/by-vdev/K9-part1 joined tank",
      data: { rejoined: false },
    });
    expect(vdevRow("1").parentId).toBe(vdevRow(k1.parentGuid ?? "").id);
  });

  it("records vdev and pool state changes with a reading only for the change", () => {
    run("zpool-status", marsStatus());
    const readingsBefore = db.select().from(vdevReading).all().length;
    const degraded = marsStatus();
    tank(degraded).state = "DEGRADED";
    Object.assign(vdevNamed(degraded, "/dev/disk/by-vdev/K1-part1"), {
      state: "FAULTED",
      readErrors: 3,
    });

    run("zpool-status", degraded, minutesAfter(10));
    run("zpool-status", degraded, minutesAfter(20));

    expect(diary("vdev-state-changed")).toMatchObject([
      {
        subjectId: vdevRow(K1_GUID).id,
        data: { from: "ONLINE", to: "FAULTED" },
      },
    ]);
    expect(diary("pool-state-changed")).toMatchObject([
      { subjectType: "pool", data: { from: "ONLINE", to: "DEGRADED" } },
    ]);
    const k1Readings = db
      .select()
      .from(vdevReading)
      .where(eq(vdevReading.vdevId, vdevRow(K1_GUID).id))
      .orderBy(vdevReading.id)
      .all();
    expect(k1Readings.map((row) => [row.state, row.readErrors])).toEqual([
      ["ONLINE", 0],
      ["FAULTED", 3],
    ]);
    expect(db.select().from(vdevReading).all()).toHaveLength(
      readingsBefore + 1,
    );
  });

  it("records a finished scan once per end time", () => {
    const scanning = marsStatus();
    const scan = tank(scanning).scan;
    if (!scan) throw new Error("tank has no scan");
    tank(scanning).scan = { ...scan, state: "SCANNING", endTime: undefined };
    run("zpool-status", scanning);

    run("zpool-status", marsStatus(), minutesAfter(10));
    run("zpool-status", marsStatus(), minutesAfter(20));
    const later = marsStatus();
    tank(later).scan = { ...scan, endTime: 1789411657 };
    run("zpool-status", later, minutesAfter(30));

    const finished = diary("scrub-finished");
    expect(finished).toHaveLength(2);
    expect(diary("scan-finished")).toEqual([]);
    expect(finished[0]).toMatchObject({
      subjectType: "pool",
      title: "tank scrub finished with 0 errors",
      at: new Date(1789325257 * 1000),
      data: {
        function: "SCRUB",
        errors: 0,
        examined: 109269572005888,
        endTime: 1789325257,
      },
    });
  });

  it("names resilvers and unknown scan functions", () => {
    const scan = tank(marsStatus()).scan;
    if (!scan) throw new Error("tank has no scan");
    const withScan = (scanFunction: string, endTime: number) => {
      const status = marsStatus();
      tank(status).scan = { ...scan, function: scanFunction, endTime };
      return status;
    };
    run("zpool-status", withScan("SCRUB", 1));
    run("zpool-status", withScan("RESILVER", 2), minutesAfter(10));
    run("zpool-status", withScan("REBUILD", 3), minutesAfter(20));

    expect(diary("resilver-finished")).toMatchObject([
      {
        title: "tank resilver finished with 0 errors",
        data: { function: "RESILVER", endTime: 2 },
      },
    ]);
    expect(diary("scan-finished")).toMatchObject([
      { data: { function: "REBUILD", endTime: 3 } },
    ]);
  });

  it("moves a pool to its new host", () => {
    const marsId = run("zpool-status", marsStatus());
    const venusId = run(
      "zpool-status",
      marsStatus(),
      minutesAfter(10),
      "venus",
    );

    const tankRow = db
      .select()
      .from(pool)
      .where(eq(pool.guid, TANK_GUID))
      .get();
    expect(tankRow?.hostId).toBe(venusId);
    expect(diary("pool-moved")).toMatchObject([
      {
        subjectId: tankRow?.id,
        data: { fromHostId: marsId, toHostId: venusId },
      },
      { data: { fromHostId: marsId } },
    ]);
  });
});

describe("zpool-list", () => {
  it("fills capacity onto known pools", () => {
    run("zpool-status", marsStatus());
    run(
      "zpool-list",
      parseZpoolList(readFixture("mars/zpool-list.json"), {}).data,
    );
    const tankRow = db
      .select()
      .from(pool)
      .where(eq(pool.guid, TANK_GUID))
      .get();
    expect(tankRow).toMatchObject({
      sizeBytes: 174457276596224,
      allocBytes: 110645022535680,
      freeBytes: 63812254060544,
      frag: 9,
      cap: 63,
      dedup: 1,
      health: "ONLINE",
    });

    run("zpool-status", marsStatus(), minutesAfter(10));
    const latest = db
      .select()
      .from(poolReading)
      .where(eq(poolReading.poolId, tankRow?.id ?? 0))
      .orderBy(poolReading.id)
      .all()
      .at(-1);
    expect(latest).toMatchObject({ allocBytes: 110645022535680, cap: 63 });
  });

  it("ignores pools it has not seen in zpool-status", () => {
    run(
      "zpool-list",
      parseZpoolList(readFixture("mars/zpool-list.json"), {}).data,
    );
    expect(db.select().from(pool).all()).toEqual([]);
  });
});

describe("disk linking", () => {
  it("links mars leaves after lsblk, udev and vdev_id.conf", () => {
    ingestMarsDisks();
    run("zpool-status", marsStatus());

    const leaves = db.select().from(vdev).where(eq(vdev.type, "disk")).all();
    const unlinked = leaves
      .filter((row) => row.diskId === null)
      .map((row) => row.name);
    expect(leaves).toHaveLength(17);
    expect(unlinked).toEqual([]);
  });

  it("links by devid when the path is not a by-vdev alias", () => {
    ingestMarsDisks();
    const status = marsStatus();
    Object.assign(vdevNamed(status, "/dev/disk/by-vdev/K1-part1"), {
      path: "/dev/sda1",
    });
    run("zpool-status", status);
    expect(vdevRow(K1_GUID).diskId).not.toBeNull();
  });

  it("links scsi-3 devids through lsblk's wwn before udev arrives", () => {
    ingest("lsblk", readFixture("mars/lsblk.json"));
    run("zpool-status", marsStatus());

    const unlinked = db
      .select()
      .from(vdev)
      .where(eq(vdev.type, "disk"))
      .all()
      .filter((row) => row.diskId === null)
      .map((row) => row.devid);
    expect(unlinked).toEqual([
      "ata-Samsung_SSD_870_EVO_2TB_J294ML0T789652K-part1",
      "ata-Samsung_SSD_870_EVO_2TB_O706TI4O632365L-part1",
    ]);
  });

  it("re-links a vdev whose disk was swapped", () => {
    ingestMarsDisks();
    run("zpool-status", marsStatus());
    const k2Disk = vdevRow("7754709500497991879").diskId;
    const swapped = marsStatus();
    Object.assign(vdevNamed(swapped, "/dev/disk/by-vdev/K1-part1"), {
      path: "/dev/disk/by-vdev/K2-part1",
      devid: "scsi-35000ccad5ed6ee0c-part1",
    });
    run("zpool-status", swapped, minutesAfter(10));
    expect(vdevRow(K1_GUID).diskId).toBe(k2Disk);
  });

  it("links once the disks are known", () => {
    run("zpool-status", marsStatus());
    expect(
      db.select().from(vdev).where(isNotNull(vdev.diskId)).all(),
    ).toHaveLength(0);
    ingestMarsDisks();
    run("zpool-status", marsStatus(), minutesAfter(10));
    expect(
      db.select().from(vdev).where(isNotNull(vdev.diskId)).all(),
    ).toHaveLength(17);
  });
});

function marsEvents() {
  return parseZpoolEvents(readFixture("mars/zpool-events.txt"), {}).data;
}

function event(eid: number | null, at: string, overrides = {}): ZfsEvent {
  return {
    eid,
    class: "sysevent.fs.zfs.config_sync",
    at,
    poolGuid: TANK_GUID,
    vdevGuid: null,
    pool: "tank",
    fields: {},
    ...overrides,
  };
}

describe("zfs events", () => {
  it("stores zpool events once", () => {
    const hostId = run("zpool-events", marsEvents());
    run("zpool-events", marsEvents(), minutesAfter(10));

    const rows = db
      .select()
      .from(zfsEvent)
      .where(eq(zfsEvent.hostId, hostId))
      .all();
    expect(rows).toHaveLength(marsEvents().events.length);
    expect(rows[0]).toMatchObject({
      eid: 0x2c1,
      class: "sysevent.fs.zfs.history_event",
      poolGuid: TANK_GUID,
      payload: { history_internal_name: "destroy" },
    });
    expect(diary()).toEqual([]);
  });

  it("dedupes events without an eid on time and class", () => {
    const q2 = parseZpoolEvents(
      readFixture("events/q2-failure-2025-05.txt"),
      {},
    ).data;
    expect(q2.events.some((candidate) => candidate.eid === null)).toBe(true);
    run("zpool-events", q2);
    run("zpool-events", q2, minutesAfter(10));
    expect(db.select().from(zfsEvent).all()).toHaveLength(q2.events.length);
  });

  it("stores a zed event and dedupes it against zpool events", () => {
    const body = [
      "ZEVENT_EID=1217",
      "ZEVENT_CLASS=sysevent.fs.zfs.config_sync",
      `ZEVENT_POOL_GUID=${TANK_GUID}`,
      "ZEVENT_TIME_SECS=1790604000",
      "ZEVENT_TIME_NSECS=0",
    ].join("\n");
    run("zpool-events", marsEvents());
    run("zed-event", parseZedEvent(body, {}).data, minutesAfter(1));
    run("zed-event", parseZedEvent(body, {}).data, minutesAfter(2));
    expect(
      db.select().from(zfsEvent).where(eq(zfsEvent.eid, 1217)).all(),
    ).toHaveLength(1);
    expect(diary()).toEqual([]);
  });

  it("records a gap in event ids", () => {
    const hostId = run("zed-event", {
      event: event(100, "2026-09-28T10:00:00Z"),
    });
    run("zed-event", { event: event(101, "2026-09-28T10:01:00Z") });
    run(
      "zpool-events",
      {
        events: [
          event(101, "2026-09-28T10:01:00Z"),
          event(105, "2026-09-28T10:05:00Z"),
          event(106, "2026-09-28T10:06:00Z"),
        ],
      },
      minutesAfter(10),
    );
    expect(diary("events-gap")).toMatchObject([
      { subjectType: "host", subjectId: hostId, data: { from: 101, to: 105 } },
    ]);
  });

  it("records an event id reset once and keeps the new events", () => {
    run("zpool-events", {
      events: [
        event(1, "2026-09-01T10:00:00Z"),
        event(2, "2026-09-01T10:01:00Z"),
        event(3, "2026-09-01T10:02:00Z"),
      ],
    });
    const rebooted = {
      events: [
        event(1, "2026-09-28T10:00:00Z"),
        event(2, "2026-09-28T10:01:00Z"),
      ],
    };
    run("zpool-events", rebooted, minutesAfter(10));
    run("zpool-events", rebooted, minutesAfter(20));

    expect(diary("events-reset")).toHaveLength(1);
    expect(diary("events-gap")).toHaveLength(0);
    const rows = db.select().from(zfsEvent).orderBy(zfsEvent.id).all();
    expect(rows.map((row) => row.eid)).toEqual([null, null, null, 1, 2]);
  });

  it("records a reset when all new ids are below the stored ones", () => {
    run("zed-event", { event: event(500, "2026-09-01T10:00:00Z") });
    run("zed-event", { event: event(3, "2026-09-28T10:00:00Z") });
    expect(diary("events-reset")).toHaveLength(1);
  });
});

describe("zpool-history", () => {
  it("stores history once, host-scoped when headers were cut", () => {
    const history = parseZpoolHistory(
      readFixture("mars/zpool-history.txt"),
      {},
    ).data;
    const hostId = run("zpool-history", history);
    run("zpool-history", history, minutesAfter(10));
    const rows = db.select().from(poolHistory).all();
    const distinct = new Set(
      history.entries.map((entry) => `${entry.at}\0${entry.text}`),
    );
    expect(rows).toHaveLength(distinct.size);
    expect(
      rows.every((row) => row.hostId === hostId && row.poolId === null),
    ).toBe(true);
  });

  it("attaches entries to a pool by name, including ones stored without it", () => {
    run("zpool-status", marsStatus());
    const entry = {
      at: "2026-09-28T16:00:09.000Z",
      timestamp: "2026-09-28.16:00:09",
      internal: false,
      txg: null,
      text: "zpool scrub tank",
      user: null,
      host: null,
    };
    run("zpool-history", { entries: [{ ...entry, pool: null }] });
    run("zpool-history", { entries: [{ ...entry, pool: "tank" }] });
    run("zpool-history", { entries: [{ ...entry, pool: null }] });
    const tankRow = db
      .select()
      .from(pool)
      .where(eq(pool.guid, TANK_GUID))
      .get();
    expect(db.select().from(poolHistory).all()).toMatchObject([
      { poolId: tankRow?.id, text: "zpool scrub tank" },
    ]);
  });
});

describe("pool queries", () => {
  it("lists pools with host, capacity and a nested vdev tree", () => {
    ingestMarsDisks();
    run("zpool-status", marsStatus());
    run(
      "zpool-list",
      parseZpoolList(readFixture("mars/zpool-list.json"), {}).data,
    );

    const pools = listPools();
    expect(pools.map((row) => row.name)).toEqual(["tank", "zeta"]);
    const [tankSummary] = pools;
    expect(tankSummary).toMatchObject({
      guid: TANK_GUID,
      host: { name: "mars", displayName: null },
      cap: 63,
      scan: { state: "FINISHED" },
      vdevs: { type: "root", name: "tank" },
    });
    expect(tankSummary?.vdevs?.children.map((child) => child.name)).toEqual([
      "mirror-4",
      "raidz1-0",
      "raidz1-1",
      "raidz1-2",
      "raidz1-3",
    ]);
    const k1 = flatten(tankSummary?.vdevs ?? null).find(
      (node) => node.guid === K1_GUID,
    );
    expect(k1?.disk).toMatchObject({ alias: "K1", latestStatus: "unknown" });
    expect(k1?.children).toEqual([]);
  });

  it("hides vdevs that have left", () => {
    run("zpool-status", marsStatus());
    const without = marsStatus();
    tank(without).vdevs = tank(without).vdevs.filter(
      (candidate) => candidate.guid !== K1_GUID,
    );
    run("zpool-status", without, minutesAfter(10));
    const nodes = flatten(listPools()[0]?.vdevs ?? null);
    expect(nodes.some((node) => node.guid === K1_GUID)).toBe(false);
  });

  it("returns pool detail with readings, diary, history and events", () => {
    run("zpool-status", marsStatus());
    const without = marsStatus();
    tank(without).vdevs = tank(without).vdevs.filter(
      (candidate) => candidate.guid !== K1_GUID,
    );
    run("zpool-status", without, minutesAfter(10));
    run("zpool-events", marsEvents());
    run(
      "zpool-history",
      parseZpoolHistory(readFixture("mars/zpool-history.txt"), {}).data,
    );
    const tankRow = db
      .select()
      .from(pool)
      .where(eq(pool.guid, TANK_GUID))
      .get();

    const detail = getPool(tankRow?.id ?? 0, minutesAfter(20));
    expect(detail.readings).toHaveLength(2);
    expect(detail.diary.map((entry) => entry.eventType)).toEqual(["vdev-left"]);
    expect(detail.historyScope).toBe("host");
    expect(detail.history).toHaveLength(50);
    expect(detail.events).toHaveLength(50);
    expect(detail.events.every((row) => row.poolGuid === TANK_GUID)).toBe(true);
    expect(
      (detail.events[0]?.at.getTime() ?? 0) >=
        (detail.events[49]?.at.getTime() ?? 0),
    ).toBe(true);
  });

  it("scopes history to the pool when it has its own", () => {
    run("zpool-status", marsStatus());
    run("zpool-history", {
      entries: [
        {
          pool: "tank",
          at: "2026-09-28T16:00:09.000Z",
          timestamp: "2026-09-28.16:00:09",
          internal: false,
          txg: null,
          text: "zpool scrub tank",
          user: null,
          host: null,
        },
      ],
    });
    const tankRow = db
      .select()
      .from(pool)
      .where(eq(pool.guid, TANK_GUID))
      .get();
    const detail = getPool(tankRow?.id ?? 0);
    expect(detail.historyScope).toBe("pool");
    expect(detail.history).toHaveLength(1);
  });

  it("404s for an unknown pool", () => {
    expect(() => getPool(999)).toThrow(
      expect.objectContaining({ statusCode: 404 }),
    );
  });
});
