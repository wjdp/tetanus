import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import type { VdevRole } from "#shared/zfsState";
import { db } from "~~/server/database/client";
import {
  collectorRun,
  disk,
  fault,
  host,
  pool,
  vdev,
  vdevReading,
} from "~~/server/database/schema";
import { acceptFault, activeAcceptances } from "~~/server/services/acceptance";
import { addAutoEvent, listDiary } from "~~/server/services/diary";
import {
  type FaultRow,
  listFaults,
  performFaultAction,
  syncFaults,
} from "~~/server/services/faults";
import { upsertHostByName } from "~~/server/services/hosts";
import { recordIngest } from "~~/server/services/ingest";
import { ServiceError } from "~~/server/utils/serviceError";
import { flushDb } from "~~/test/db";
import { readFixture } from "~~/test/fixtures";

const t0 = new Date("2026-09-01T10:00:00Z");
const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;
const SDB = readFixture("mars/smartctl/xall-sdb-auto.json");
const SDB_SERIAL = JSON.parse(SDB).serial_number as string;

function at(offsetMs: number) {
  return new Date(t0.getTime() + offsetMs);
}

function withAttributeRaw(body: string, attrId: number, raw: number) {
  const json = JSON.parse(body);
  const attribute = json.ata_smart_attributes.table.find(
    (row: { id: number }) => row.id === attrId,
  );
  attribute.raw = { value: raw, string: String(raw) };
  return JSON.stringify(json);
}

function ingestSmart(body: string, receivedAt = t0) {
  const outcome = recordIngest({
    hostName: "mars",
    source: "smartctl-xall",
    meta: { device: "/dev/sdb", type: "sat", exitStatus: 0 },
    body,
    receivedAt,
  });
  expect(outcome.ok).toBe(true);
}

function k2Id() {
  return (
    db
      .select({ id: disk.id })
      .from(disk)
      .where(eq(disk.serial, SDB_SERIAL))
      .get() as { id: number }
  ).id;
}

function recordRun(hostId: number, source: string, receivedAt: Date) {
  db.insert(collectorRun)
    .values({ hostId, source, receivedAt, ok: true, bytes: 0 })
    .run();
}

function faultsOf(kind: string): FaultRow[] {
  return db
    .select()
    .from(fault)
    .where(eq(fault.kind, kind as FaultRow["kind"]))
    .orderBy(fault.id)
    .all();
}

function liveFault(kind: string, key: string): FaultRow | undefined {
  return faultsOf(kind).find((row) => row.key === key && !row.resolvedAt);
}

function faultEvents() {
  return listDiary({ limit: 1000 })
    .filter((entry) => entry.eventType?.startsWith("fault-"))
    .filter((entry) => typeof entry.data.faultId === "number")
    .reverse();
}

function expectServiceError(operation: () => unknown, statusCode: number) {
  try {
    operation();
  } catch (error) {
    expect(error).toBeInstanceOf(ServiceError);
    expect((error as ServiceError).statusCode).toBe(statusCode);
    return;
  }
  throw new Error(`expected a ${statusCode} ServiceError`);
}

function insertPool(hostId: number, state: string, seenAt: Date) {
  return db
    .insert(pool)
    .values({
      hostId,
      guid: "123",
      name: "vault",
      state,
      firstSeenAt: seenAt,
      lastSeenAt: seenAt,
    })
    .returning()
    .get();
}

function observePool(
  poolId: number,
  hostId: number,
  state: string,
  seenAt: Date,
) {
  db.update(pool)
    .set({ state, lastSeenAt: seenAt })
    .where(eq(pool.id, poolId))
    .run();
  recordRun(hostId, "zpool-status", seenAt);
}

beforeEach(() => {
  flushDb();
});

describe("collector-silent", () => {
  it("opens for a silent host, resolves when data arrives, and writes the diary", async () => {
    const mars = upsertHostByName("mars", t0);
    recordRun(mars.id, "zpool-status", t0);

    await syncFaults(at(10 * MINUTE_MS));
    expect(faultsOf("collector-silent")).toEqual([]);

    await syncFaults(at(DAY_MS));
    expect(liveFault("collector-silent", String(mars.id))).toMatchObject({
      state: "open",
      severity: "error",
      category: "host",
      subjectType: "host",
      subjectId: mars.id,
      openedAt: at(DAY_MS),
      data: { lastOkAt: t0.toISOString() },
    });

    await syncFaults(at(DAY_MS + HOUR_MS));
    expect(faultsOf("collector-silent")).toHaveLength(1);
    expect(faultsOf("collector-silent")[0].lastSeenAt).toEqual(
      at(DAY_MS + HOUR_MS),
    );

    recordRun(mars.id, "zpool-status", at(2 * DAY_MS));
    await syncFaults(at(2 * DAY_MS));
    expect(faultsOf("collector-silent")).toMatchObject([
      { state: "resolved", resolvedAt: at(2 * DAY_MS) },
    ]);
    expect(faultEvents().map((entry) => entry.eventType)).toEqual([
      "fault-opened",
      "fault-resolved",
    ]);
  });

  it("faults the host, not its disks", async () => {
    recordIngest({
      hostName: "mars",
      source: "lsblk",
      meta: {},
      body: readFixture("mars/lsblk.json"),
      receivedAt: t0,
    });

    await syncFaults(at(DAY_MS));

    expect(faultsOf("collector-silent")).toHaveLength(1);
    expect(faultsOf("disk-missing")).toEqual([]);
  });

  it("never faults an intermittent host that is offline", async () => {
    const mars = upsertHostByName("mars", t0);
    db.update(host)
      .set({ intermittent: true })
      .where(eq(host.id, mars.id))
      .run();
    recordRun(mars.id, "zpool-status", t0);

    await syncFaults(at(30 * DAY_MS));

    expect(faultsOf("collector-silent")).toEqual([]);
  });

  it("ends an acknowledgement with the occurrence; a recurrence opens a new fault", async () => {
    const mars = upsertHostByName("mars", t0);
    recordRun(mars.id, "zpool-status", t0);
    await syncFaults(at(DAY_MS));
    const first = liveFault("collector-silent", String(mars.id)) as FaultRow;

    expect(
      performFaultAction(first.id, "acknowledge", {
        note: "Powered off for a move",
        now: at(DAY_MS + MINUTE_MS),
      }),
    ).toMatchObject({ state: "acknowledged", note: "Powered off for a move" });

    recordRun(mars.id, "zpool-status", at(2 * DAY_MS));
    await syncFaults(at(2 * DAY_MS));
    await syncFaults(at(4 * DAY_MS));

    expect(faultsOf("collector-silent")).toMatchObject([
      { id: first.id, state: "resolved", note: "Powered off for a move" },
      { state: "open", note: "", openedAt: at(4 * DAY_MS) },
    ]);
  });
});

describe("collector versions", () => {
  it("opens incompatible as an error and outdated as a warning, keyed by version", async () => {
    const mars = upsertHostByName("mars", t0);
    const venus = upsertHostByName("venus", t0);
    for (const row of [mars, venus]) recordRun(row.id, "zpool-status", t0);
    db.update(host)
      .set({ collectorVersion: "0.1.0", collectorStatus: "incompatible" })
      .where(eq(host.id, mars.id))
      .run();
    db.update(host)
      .set({ collectorVersion: "0.3.0", collectorStatus: "outdated" })
      .where(eq(host.id, venus.id))
      .run();

    await syncFaults(t0);

    expect(
      liveFault("collector-incompatible", `${mars.id}:0.1.0`),
    ).toMatchObject({ severity: "error", data: { version: "0.1.0" } });
    expect(liveFault("collector-outdated", `${venus.id}:0.3.0`)).toMatchObject({
      severity: "warning",
      data: { version: "0.3.0" },
    });

    db.update(host)
      .set({ collectorVersion: "0.2.9", collectorStatus: "incompatible" })
      .where(eq(host.id, mars.id))
      .run();
    await syncFaults(at(MINUTE_MS));

    expect(faultsOf("collector-incompatible")).toMatchObject([
      { key: `${mars.id}:0.1.0`, state: "resolved" },
      { key: `${mars.id}:0.2.9`, state: "open" },
    ]);
  });
});

describe("host degraded", () => {
  function setVersions(hostId: number, zfs: string) {
    db.update(host)
      .set({ toolVersions: { zfs, smartctl: "smartctl 7.4 2023-08-01 r5530" } })
      .where(eq(host.id, hostId))
      .run();
  }

  it("opens a warning per unsupported tool version, quiet once accepted", async () => {
    const mars = upsertHostByName("mars", t0);
    recordRun(mars.id, "versions", t0);
    setVersions(mars.id, "zfs-2.2.2-0ubuntu9.1");

    await syncFaults(t0);

    const opened = liveFault("host-degraded", `${mars.id}:openzfs:2.2.2`);
    expect(opened).toMatchObject({
      severity: "warning",
      state: "open",
      data: { tool: "openzfs", version: "2.2.2", minVersion: "2.3" },
    });

    performFaultAction((opened as FaultRow).id, "accept", {
      now: at(MINUTE_MS),
    });
    await syncFaults(at(2 * MINUTE_MS));
    expect(
      liveFault("host-degraded", `${mars.id}:openzfs:2.2.2`),
    ).toMatchObject({
      state: "accepted",
    });

    setVersions(mars.id, "zfs-2.2.6-1");
    await syncFaults(at(3 * MINUTE_MS));
    expect(faultsOf("host-degraded")).toMatchObject([
      { key: `${mars.id}:openzfs:2.2.2`, state: "resolved" },
      { key: `${mars.id}:openzfs:2.2.6`, state: "open" },
    ]);

    setVersions(mars.id, "zfs-2.3.4-1");
    await syncFaults(at(4 * MINUTE_MS));
    expect(faultsOf("host-degraded").every((row) => row.resolvedAt)).toBe(true);
  });
});

interface VdevSpec {
  guid: string;
  name: string;
  parentId?: number | null;
  state?: string;
  type?: string;
  role?: VdevRole;
  spareState?: string;
  diskId?: number | null;
  readErrors?: number;
  writeErrors?: number;
  checksumErrors?: number;
  slowIos?: number | null;
}

function insertVdev(poolId: number, spec: VdevSpec, seenAt = t0) {
  return db
    .insert(vdev)
    .values({
      poolId,
      type: "disk",
      role: "normal",
      state: "ONLINE",
      lastSeenAt: seenAt,
      ...spec,
    })
    .returning()
    .get();
}

function setVdev(guid: string, fields: Partial<VdevSpec>, readingAt?: Date) {
  const row = db
    .update(vdev)
    .set(fields)
    .where(eq(vdev.guid, guid))
    .returning()
    .get();
  if (readingAt) recordVdevReading(row.id, readingAt);
  return row;
}

function recordVdevReading(vdevId: number, readingAt: Date) {
  const row = db.select().from(vdev).where(eq(vdev.id, vdevId)).get();
  if (!row) throw new Error(`no vdev ${vdevId}`);
  db.insert(vdevReading)
    .values({
      vdevId,
      at: readingAt,
      readErrors: row.readErrors,
      writeErrors: row.writeErrors,
      checksumErrors: row.checksumErrors,
      slowIos: row.slowIos,
      state: row.state,
    })
    .run();
}

function supersededBy(kind: string) {
  return faultEvents()
    .filter(
      (entry) =>
        entry.eventType === "fault-resolved" && entry.data.kind === kind,
    )
    .map((entry) => entry.data.supersededBy);
}

function liveKinds() {
  return db
    .select()
    .from(fault)
    .all()
    .filter((row) => !row.resolvedAt)
    .map((row) => row.kind)
    .sort();
}

function ingestZpoolStatus(fixture: string, receivedAt: Date) {
  const outcome = recordIngest({
    hostName: "mars",
    source: "zpool-status",
    meta: {},
    body: readFixture(`mars/${fixture}`),
    receivedAt,
  });
  expect(outcome.ok).toBe(true);
}

describe("pool-degraded", () => {
  it("follows the pool state, reopening on a severity rise", async () => {
    const mars = upsertHostByName("mars", t0);
    const vault = insertPool(mars.id, "DEGRADED", t0);
    recordRun(mars.id, "zpool-status", t0);

    await syncFaults(t0);
    const degraded = liveFault("pool-degraded", String(vault.id)) as FaultRow;
    expect(degraded).toMatchObject({
      severity: "warning",
      category: "zfs",
      data: { state: "DEGRADED", poolName: "vault", leaves: [] },
    });

    performFaultAction(degraded.id, "accept", { now: at(MINUTE_MS) });
    observePool(vault.id, mars.id, "DEGRADED", at(10 * MINUTE_MS));
    await syncFaults(at(10 * MINUTE_MS));
    expect(liveFault("pool-degraded", String(vault.id))?.state).toBe(
      "accepted",
    );

    observePool(vault.id, mars.id, "FAULTED", at(20 * MINUTE_MS));
    await syncFaults(at(20 * MINUTE_MS));
    expect(liveFault("pool-degraded", String(vault.id))).toMatchObject({
      id: degraded.id,
      state: "open",
      severity: "error",
      data: { state: "FAULTED" },
    });

    observePool(vault.id, mars.id, "ONLINE", at(30 * MINUTE_MS));
    await syncFaults(at(30 * MINUTE_MS));
    expect(faultsOf("pool-degraded")).toMatchObject([{ state: "resolved" }]);
  });

  it("lists failed leaves; a FAULTED leaf is red while the pool stays amber", async () => {
    const mars = upsertHostByName("mars", t0);
    const vault = insertPool(mars.id, "DEGRADED", t0);
    recordRun(mars.id, "zpool-status", t0);
    insertVdev(vault.id, { guid: "11", name: "K1", state: "OFFLINE" });
    insertVdev(vault.id, { guid: "12", name: "K2" });

    await syncFaults(t0);
    expect(liveFault("pool-degraded", String(vault.id))).toMatchObject({
      severity: "warning",
      data: {
        leaves: [
          {
            vdevGuid: "11",
            name: "K1",
            state: "OFFLINE",
            role: "normal",
            diskMissing: false,
            read: 0,
          },
        ],
      },
    });

    setVdev("12", { state: "FAULTED", readErrors: 3 });
    await syncFaults(at(MINUTE_MS));
    const row = liveFault("pool-degraded", String(vault.id)) as FaultRow;
    expect(row.severity).toBe("error");
    expect(row.data.leaves).toHaveLength(2);
  });

  it("faults an ONLINE pool for a failed cache leaf", async () => {
    const mars = upsertHostByName("mars", t0);
    const vault = insertPool(mars.id, "ONLINE", t0);
    recordRun(mars.id, "zpool-status", t0);
    insertVdev(vault.id, {
      guid: "21",
      name: "C1",
      role: "cache",
      state: "UNAVAIL",
    });

    await syncFaults(t0);

    expect(liveFault("pool-degraded", String(vault.id))).toMatchObject({
      severity: "error",
      data: {
        state: "ONLINE",
        leaves: [{ name: "C1", role: "cache", state: "UNAVAIL" }],
      },
    });
  });

  it("leaves spares that are available or in use out of the list", async () => {
    upsertHostByName("mars", t0);
    ingestZpoolStatus("zpool-status-spare-avail.json", t0);
    await syncFaults(t0);
    expect(faultsOf("pool-degraded")).toEqual([]);

    ingestZpoolStatus("zpool-status-spare-inuse.json", at(MINUTE_MS));
    await syncFaults(at(MINUTE_MS));
    const row = faultsOf("pool-degraded")[0];
    expect(row.data.leaves).toMatchObject([
      { name: "/var/tmp/tspare-a.img", state: "OFFLINE" },
    ]);
    expect(row.data.leaves).toHaveLength(1);
  });

  it("reopens when a leaf joins the list or a listed leaf's errors rise", async () => {
    const mars = upsertHostByName("mars", t0);
    const vault = insertPool(mars.id, "DEGRADED", t0);
    recordRun(mars.id, "zpool-status", t0);
    insertVdev(vault.id, { guid: "11", name: "K1", state: "OFFLINE" });
    insertVdev(vault.id, { guid: "12", name: "K2" });
    await syncFaults(t0);
    const row = liveFault("pool-degraded", String(vault.id)) as FaultRow;

    performFaultAction(row.id, "acknowledge", { now: at(MINUTE_MS) });
    await syncFaults(at(2 * MINUTE_MS));
    expect(liveFault("pool-degraded", String(vault.id))?.state).toBe(
      "acknowledged",
    );

    setVdev("12", { state: "OFFLINE" });
    await syncFaults(at(3 * MINUTE_MS));
    expect(liveFault("pool-degraded", String(vault.id))?.state).toBe("open");

    performFaultAction(row.id, "acknowledge", { now: at(4 * MINUTE_MS) });
    setVdev("11", { writeErrors: 2 });
    await syncFaults(at(5 * MINUTE_MS));
    expect(liveFault("pool-degraded", String(vault.id))).toMatchObject({
      id: row.id,
      state: "open",
      severity: "warning",
    });
  });

  it("is the only fault for a pulled disk", async () => {
    const mars = upsertHostByName("mars", t0);
    recordRun(mars.id, "lsblk", at(3 * DAY_MS));
    recordRun(mars.id, "zpool-status", at(3 * DAY_MS));
    const diskId = db
      .insert(disk)
      .values({
        alias: "K3",
        lastSeenAt: t0,
        lastSeenHostId: mars.id,
        lastState: "in-use",
      })
      .returning()
      .get().id;
    const vault = insertPool(mars.id, "DEGRADED", at(3 * DAY_MS));
    insertVdev(vault.id, { guid: "13", name: "K3", state: "REMOVED", diskId });

    await syncFaults(at(3 * DAY_MS));

    expect(liveKinds()).toEqual(["pool-degraded"]);
    expect(
      liveFault("pool-degraded", String(vault.id))?.data.leaves,
    ).toMatchObject([{ diskId, state: "REMOVED", diskMissing: true }]);
  });

  it("resolves an open disk-missing it now explains", async () => {
    const mars = upsertHostByName("mars", t0);
    recordRun(mars.id, "lsblk", at(3 * DAY_MS));
    recordRun(mars.id, "zpool-status", at(3 * DAY_MS));
    const diskId = db
      .insert(disk)
      .values({
        alias: "K3",
        lastSeenAt: t0,
        lastSeenHostId: mars.id,
        lastState: "in-use",
      })
      .returning()
      .get().id;
    await syncFaults(at(3 * DAY_MS));
    expect(liveKinds()).toEqual(["disk-missing"]);

    const vault = insertPool(mars.id, "DEGRADED", at(3 * DAY_MS + HOUR_MS));
    insertVdev(vault.id, { guid: "13", name: "K3", state: "REMOVED", diskId });
    recordRun(mars.id, "zpool-status", at(3 * DAY_MS + HOUR_MS));
    await syncFaults(at(3 * DAY_MS + HOUR_MS));

    expect(liveKinds()).toEqual(["pool-degraded"]);
    expect(supersededBy("disk-missing")).toEqual([
      { kind: "pool-degraded", key: String(vault.id) },
    ]);
  });
});

describe("pool-missing", () => {
  it("opens when the pool drops out of a fresh zpool-status, folding the pool's other faults", async () => {
    const mars = upsertHostByName("mars", t0);
    const vault = insertPool(mars.id, "DEGRADED", t0);
    recordRun(mars.id, "zpool-status", t0);
    await syncFaults(t0);

    recordRun(mars.id, "zpool-status", at(10 * MINUTE_MS));
    await syncFaults(at(10 * MINUTE_MS));

    expect(faultsOf("pool-degraded")).toMatchObject([
      { key: String(vault.id), state: "resolved" },
    ]);
    expect(supersededBy("pool-degraded")).toEqual([
      { kind: "pool-missing", key: String(vault.id) },
    ]);
    expect(liveFault("pool-missing", String(vault.id))).toMatchObject({
      severity: "warning",
      data: { poolName: "vault", lastSeenAt: t0.toISOString() },
    });

    observePool(vault.id, mars.id, "ONLINE", at(20 * MINUTE_MS));
    await syncFaults(at(20 * MINUTE_MS));
    expect(faultsOf("pool-missing")).toMatchObject([{ state: "resolved" }]);
  });

  it("suppresses disk-missing for its member disks", async () => {
    const mars = upsertHostByName("mars", t0);
    recordRun(mars.id, "lsblk", at(3 * DAY_MS));
    const diskId = db
      .insert(disk)
      .values({
        alias: "K3",
        lastSeenAt: t0,
        lastSeenHostId: mars.id,
        lastState: "in-use",
      })
      .returning()
      .get().id;
    const vault = insertPool(mars.id, "ONLINE", t0);
    insertVdev(vault.id, { guid: "13", name: "K3", diskId });
    recordRun(mars.id, "zpool-status", at(3 * DAY_MS));

    await syncFaults(at(3 * DAY_MS));

    expect(liveKinds()).toEqual(["pool-missing"]);
  });

  it("is not raised for a silent or offline intermittent host", async () => {
    const mars = upsertHostByName("mars", t0);
    const vault = insertPool(mars.id, "ONLINE", t0);
    recordRun(mars.id, "zpool-status", at(MINUTE_MS));

    await syncFaults(at(DAY_MS));
    expect(liveKinds()).toEqual(["collector-silent"]);

    db.update(host)
      .set({ intermittent: true })
      .where(eq(host.id, mars.id))
      .run();
    await syncFaults(at(2 * DAY_MS));
    expect(liveKinds()).toEqual([]);
    expect(faultsOf("pool-missing")).toEqual([]);
    expect(vault.id).toBeGreaterThan(0);
  });
});

describe("silent host", () => {
  it("raises no pool faults and resolves live ones as superseded", async () => {
    const mars = upsertHostByName("mars", t0);
    const vault = insertPool(mars.id, "DEGRADED", t0);
    recordRun(mars.id, "zpool-status", t0);
    await syncFaults(t0);

    await syncFaults(at(DAY_MS));

    expect(liveKinds()).toEqual(["collector-silent"]);
    expect(supersededBy("pool-degraded")).toEqual([
      { kind: "collector-silent", key: String(mars.id) },
    ]);
    expect(vault.id).toBeGreaterThan(0);
  });
});

describe("leaf-errors", () => {
  function setUp() {
    const mars = upsertHostByName("mars", t0);
    const vault = insertPool(mars.id, "ONLINE", t0);
    const leaf = insertVdev(vault.id, {
      guid: "31",
      name: "/dev/disk/by-vdev/A7",
    });
    recordVdevReading(leaf.id, t0);
    const status = (offsetMs: number, fields: Partial<VdevSpec>) => {
      setVdev("31", fields, at(offsetMs));
      observePool(vault.id, mars.id, "ONLINE", at(offsetMs));
    };
    recordRun(mars.id, "zpool-status", t0);
    return { vault, status, key: `${vault.id}:31` };
  }

  it("opens amber on an ONLINE leaf with errors, with the 24 h rise", async () => {
    const { status, key } = setUp();
    status(HOUR_MS, { checksumErrors: 8 });
    status(2 * HOUR_MS, { checksumErrors: 12 });

    await syncFaults(at(2 * HOUR_MS));

    expect(liveFault("leaf-errors", key)).toMatchObject({
      severity: "warning",
      subjectType: "pool",
      data: {
        name: "/dev/disk/by-vdev/A7",
        role: "normal",
        read: 0,
        write: 0,
        checksum: 12,
        rise24h: 12,
      },
    });
  });

  it("raises errors on a group as red", async () => {
    const mars = upsertHostByName("mars", t0);
    const vault = insertPool(mars.id, "ONLINE", t0);
    recordRun(mars.id, "zpool-status", t0);
    insertVdev(vault.id, {
      guid: "40",
      name: "raidz1-0",
      type: "raidz",
      checksumErrors: 2,
    });

    await syncFaults(t0);

    expect(liveFault("leaf-errors", `${vault.id}:40`)).toMatchObject({
      severity: "error",
      data: { role: "group", checksum: 2 },
    });
  });

  it("holds an acknowledgement at its level, through a counter reset, and reopens on a rise", async () => {
    const { status, key } = setUp();
    status(HOUR_MS, { checksumErrors: 12 });
    await syncFaults(at(HOUR_MS));
    const row = liveFault("leaf-errors", key) as FaultRow;

    performFaultAction(row.id, "acknowledge", { now: at(2 * HOUR_MS) });
    expect(liveFault("leaf-errors", key)?.data).toMatchObject({
      acknowledgedCounts: { read: 0, write: 0, checksum: 12 },
    });

    status(3 * HOUR_MS, { checksumErrors: 0 });
    await syncFaults(at(3 * HOUR_MS));
    expect(liveFault("leaf-errors", key)).toMatchObject({
      id: row.id,
      state: "acknowledged",
      data: { checksum: 0, total: { checksum: 12 } },
    });

    status(4 * HOUR_MS, { checksumErrors: 1 });
    await syncFaults(at(4 * HOUR_MS));
    const reopened = liveFault("leaf-errors", key) as FaultRow;
    expect(reopened).toMatchObject({
      id: row.id,
      state: "open",
      data: { checksum: 1, total: { checksum: 13 } },
    });
    expect(reopened.data.acknowledgedCounts).toBeUndefined();
  });

  it("resolves only by hand, and after that opens again only on a rise", async () => {
    const { status, key } = setUp();
    status(HOUR_MS, { checksumErrors: 12 });
    await syncFaults(at(HOUR_MS));
    const row = liveFault("leaf-errors", key) as FaultRow;

    expect(
      performFaultAction(row.id, "resolve", {
        note: "zpool clear after cable swap",
        now: at(2 * HOUR_MS),
      }),
    ).toMatchObject({ state: "resolved" });
    await syncFaults(at(3 * HOUR_MS));
    expect(liveFault("leaf-errors", key)).toBeUndefined();

    status(4 * HOUR_MS, { checksumErrors: 14 });
    await syncFaults(at(4 * HOUR_MS));
    expect(liveFault("leaf-errors", key)).toMatchObject({
      state: "open",
      data: { checksum: 14, total: { checksum: 2 } },
    });
  });

  it("folds into pool-degraded when ZFS fails the leaf", async () => {
    const { vault, status, key } = setUp();
    status(HOUR_MS, { checksumErrors: 12 });
    await syncFaults(at(HOUR_MS));

    status(2 * HOUR_MS, { state: "FAULTED" });
    observePool(vault.id, vault.hostId, "DEGRADED", at(2 * HOUR_MS));
    await syncFaults(at(2 * HOUR_MS));

    expect(liveFault("leaf-errors", key)).toBeUndefined();
    expect(supersededBy("leaf-errors")).toEqual([
      { kind: "pool-degraded", key: String(vault.id) },
    ]);
    expect(
      liveFault("pool-degraded", String(vault.id))?.data.leaves,
    ).toMatchObject([{ vdevGuid: "31", checksum: 12 }]);
  });
});

describe("leaf-slow", () => {
  it("opens when slow I/Os rise past the pool threshold within 24 h, and resolves after", async () => {
    const mars = upsertHostByName("mars", t0);
    const vault = insertPool(mars.id, "ONLINE", t0);
    const leaf = insertVdev(vault.id, { guid: "31", name: "A7", slowIos: 0 });
    recordVdevReading(leaf.id, t0);
    recordRun(mars.id, "zpool-status", t0);
    const key = `${vault.id}:31`;

    setVdev("31", { slowIos: 9 }, at(HOUR_MS));
    observePool(vault.id, mars.id, "ONLINE", at(HOUR_MS));
    await syncFaults(at(HOUR_MS));
    expect(liveFault("leaf-slow", key)).toBeUndefined();

    setVdev("31", { slowIos: 14 }, at(2 * HOUR_MS));
    observePool(vault.id, mars.id, "ONLINE", at(2 * HOUR_MS));
    await syncFaults(at(2 * HOUR_MS));
    expect(liveFault("leaf-slow", key)).toMatchObject({
      severity: "warning",
      data: { slowIos: 14, rise24h: 14, threshold: 10 },
    });

    observePool(vault.id, mars.id, "ONLINE", at(2 * DAY_MS));
    await syncFaults(at(2 * DAY_MS));
    expect(liveFault("leaf-slow", key)).toBeUndefined();
  });

  it("is off when the pool's threshold is 0", async () => {
    const mars = upsertHostByName("mars", t0);
    const vault = insertPool(mars.id, "ONLINE", t0);
    db.update(pool)
      .set({ config: { slowIoThreshold: 0 } })
      .where(eq(pool.id, vault.id))
      .run();
    insertVdev(vault.id, { guid: "31", name: "A7", slowIos: 500 });
    recordRun(mars.id, "zpool-status", t0);

    await syncFaults(t0);

    expect(faultsOf("leaf-slow")).toEqual([]);
  });
});

describe("pool-data-errors", () => {
  it("opens on permanent errors or a scan with errors, resolving when both are 0", async () => {
    const mars = upsertHostByName("mars", t0);
    const vault = insertPool(mars.id, "ONLINE", t0);
    recordRun(mars.id, "zpool-status", t0);
    const scan = (errors: number, offsetMs: number) =>
      addAutoEvent({
        subjectType: "pool",
        subjectId: vault.id,
        eventType: "scrub-finished",
        title: "scrub finished",
        data: { function: "SCRUB", errors },
        at: at(offsetMs),
      });

    scan(3, 0);
    await syncFaults(at(MINUTE_MS));
    expect(liveFault("pool-data-errors", String(vault.id))).toMatchObject({
      severity: "error",
      data: {
        scanErrors: 3,
        dataErrors: 0,
        function: "SCRUB",
        poolName: "vault",
      },
    });

    db.update(pool).set({ errors: 2 }).where(eq(pool.id, vault.id)).run();
    scan(0, HOUR_MS);
    observePool(vault.id, mars.id, "ONLINE", at(HOUR_MS));
    await syncFaults(at(HOUR_MS));
    expect(liveFault("pool-data-errors", String(vault.id))).toMatchObject({
      data: { scanErrors: 0, dataErrors: 2 },
    });

    db.update(pool).set({ errors: 0 }).where(eq(pool.id, vault.id)).run();
    observePool(vault.id, mars.id, "ONLINE", at(2 * HOUR_MS));
    await syncFaults(at(2 * HOUR_MS));
    expect(supersededBy("pool-data-errors")).toEqual([undefined]);
    expect(faultsOf("pool-data-errors")).toMatchObject([{ state: "resolved" }]);
  });
});

describe("scrub-overdue", () => {
  it("counts from the last scrub, or from first sighting for a pool never scrubbed", async () => {
    const mars = upsertHostByName("mars", t0);
    const vault = insertPool(mars.id, "ONLINE", t0);
    const seenAt = (offsetMs: number) =>
      observePool(vault.id, mars.id, "ONLINE", at(offsetMs));

    seenAt(35 * DAY_MS);
    await syncFaults(at(35 * DAY_MS));
    expect(faultsOf("scrub-overdue")).toEqual([]);

    seenAt(36 * DAY_MS);
    await syncFaults(at(36 * DAY_MS));
    expect(liveFault("scrub-overdue", String(vault.id))).toMatchObject({
      severity: "warning",
      data: { lastScrubAt: null, intervalDays: 35 },
    });

    db.update(pool)
      .set({
        lastScrub: {
          endAt: at(36 * DAY_MS).toISOString(),
          errors: 0,
          repairedBytes: 0,
          durationS: 60,
        },
      })
      .where(eq(pool.id, vault.id))
      .run();
    seenAt(37 * DAY_MS);
    await syncFaults(at(37 * DAY_MS));
    expect(faultsOf("scrub-overdue")).toMatchObject([{ state: "resolved" }]);

    db.update(pool)
      .set({ config: { scrubIntervalDays: 0 } })
      .where(eq(pool.id, vault.id))
      .run();
    seenAt(200 * DAY_MS);
    await syncFaults(at(200 * DAY_MS));
    expect(liveFault("scrub-overdue", String(vault.id))).toBeUndefined();
  });
});

function setPool(poolId: number, fields: Partial<typeof pool.$inferInsert>) {
  db.update(pool).set(fields).where(eq(pool.id, poolId)).run();
}

const scanning = (fields: Partial<NonNullable<FaultPoolScan>> = {}) => ({
  function: "SCRUB",
  state: "SCANNING",
  startTime: t0.getTime() / 1000,
  examined: 100,
  toExamine: 1000,
  issued: 90,
  errors: 0,
  ...fields,
});

type FaultPoolScan = (typeof pool.$inferSelect)["scan"];

describe("pool-status", () => {
  async function withMsgid(msgid: string | null, offsetMs = 0) {
    const mars = upsertHostByName("mars", t0);
    const vault =
      db.select().from(pool).get() ?? insertPool(mars.id, "ONLINE", t0);
    setPool(vault.id, {
      msgid,
      status: "Something new happened.\n\tMore detail.\n",
    });
    observePool(vault.id, mars.id, "ONLINE", at(offsetMs));
    await syncFaults(at(offsetMs));
    return vault;
  }

  it("raises catalogued codes at their severity and resolves when the code clears", async () => {
    const vault = await withMsgid("ZFS-8000-EY");
    expect(liveFault("pool-status", `${vault.id}:ZFS-8000-EY`)).toMatchObject({
      severity: "warning",
      data: { msgid: "ZFS-8000-EY", title: "ZFS label hostid mismatch" },
    });

    await withMsgid("ZFS-8000-K4", MINUTE_MS);
    expect(liveFault("pool-status", `${vault.id}:ZFS-8000-K4`)).toMatchObject({
      severity: "error",
    });
    expect(liveFault("pool-status", `${vault.id}:ZFS-8000-EY`)).toBeUndefined();

    await withMsgid(null, 2 * MINUTE_MS);
    expect(liveKinds()).not.toContain("pool-status");
  });

  it("raises an unknown code as a warning with the status text", async () => {
    const vault = await withMsgid("ZFS-8000-ZZ");
    expect(liveFault("pool-status", `${vault.id}:ZFS-8000-ZZ`)).toMatchObject({
      severity: "warning",
      data: {
        title: null,
        status: "Something new happened.\n\tMore detail.\n",
      },
    });
  });

  it.each(["ZFS-8000-8A", "ZFS-8000-2Q", "ZFS-8000-9P"])(
    "leaves %s to the kind that covers it",
    async (msgid) => {
      await withMsgid(msgid);
      expect(faultsOf("pool-status")).toEqual([]);
    },
  );
});

describe("scrub-paused", () => {
  it("opens for a scrub paused over 24 h", async () => {
    const mars = upsertHostByName("mars", t0);
    const vault = insertPool(mars.id, "ONLINE", t0);
    setPool(vault.id, {
      scan: scanning({ pausedAt: t0.getTime() / 1000 }),
      scanProgressAt: t0,
    });

    observePool(vault.id, mars.id, "ONLINE", at(DAY_MS));
    await syncFaults(at(DAY_MS));
    expect(faultsOf("scrub-paused")).toEqual([]);

    observePool(vault.id, mars.id, "ONLINE", at(DAY_MS + HOUR_MS));
    await syncFaults(at(DAY_MS + HOUR_MS));
    expect(liveFault("scrub-paused", String(vault.id))).toMatchObject({
      severity: "warning",
      data: { poolName: "vault", pausedAt: t0.toISOString() },
    });
    expect(liveKinds()).not.toContain("scan-stalled");

    setPool(vault.id, { scan: scanning(), scanProgressAt: at(DAY_MS) });
    observePool(vault.id, mars.id, "ONLINE", at(DAY_MS + 2 * HOUR_MS));
    await syncFaults(at(DAY_MS + 2 * HOUR_MS));
    expect(faultsOf("scrub-paused")).toMatchObject([{ state: "resolved" }]);
  });
});

describe("scan-stalled", () => {
  it("opens after 6 h without progress, red for a resilver", async () => {
    const mars = upsertHostByName("mars", t0);
    const vault = insertPool(mars.id, "DEGRADED", t0);
    setPool(vault.id, { scan: scanning(), scanProgressAt: t0 });

    observePool(vault.id, mars.id, "ONLINE", at(5 * HOUR_MS));
    await syncFaults(at(5 * HOUR_MS));
    expect(faultsOf("scan-stalled")).toEqual([]);

    observePool(vault.id, mars.id, "ONLINE", at(6 * HOUR_MS));
    await syncFaults(at(6 * HOUR_MS));
    expect(liveFault("scan-stalled", String(vault.id))).toMatchObject({
      severity: "warning",
      data: { function: "SCRUB", progressAt: t0.toISOString(), examined: 100 },
    });

    setPool(vault.id, { scan: scanning({ function: "RESILVER" }) });
    observePool(vault.id, mars.id, "DEGRADED", at(7 * HOUR_MS));
    await syncFaults(at(7 * HOUR_MS));
    expect(liveFault("scan-stalled", String(vault.id))?.severity).toBe("error");

    setPool(vault.id, { scanProgressAt: at(8 * HOUR_MS) });
    observePool(vault.id, mars.id, "DEGRADED", at(8 * HOUR_MS));
    await syncFaults(at(8 * HOUR_MS));
    expect(liveFault("scan-stalled", String(vault.id))).toBeUndefined();
  });
});

describe("vdev-unredundant", () => {
  it("opens for a single-device special or dedup vdev, not a log or a mirror", async () => {
    const mars = upsertHostByName("mars", t0);
    const vault = insertPool(mars.id, "ONLINE", t0);
    recordRun(mars.id, "zpool-status", t0);
    const root = insertVdev(vault.id, {
      guid: "1",
      name: "vault",
      type: "root",
    });
    const mirror = insertVdev(vault.id, {
      guid: "2",
      name: "mirror-1",
      type: "special",
      role: "special",
      parentId: root.id,
    });
    for (const [guid, name, role, parentId] of [
      ["3", "S1", "special", root.id],
      ["4", "D1", "dedup", root.id],
      ["5", "L1", "log", root.id],
      ["6", "M1", "special", mirror.id],
    ] as const) {
      insertVdev(vault.id, { guid, name, role, parentId });
    }

    await syncFaults(t0);

    expect(
      faultsOf("vdev-unredundant").map((row) => [row.key, row.data.role]),
    ).toEqual([
      [`${vault.id}:3`, "special"],
      [`${vault.id}:4`, "dedup"],
    ]);
    expect(liveFault("vdev-unredundant", `${vault.id}:3`)).toMatchObject({
      severity: "warning",
      data: { name: "S1", poolName: "vault" },
    });
  });
});

describe("identity-conflict", () => {
  it("resolves on acknowledge and only reopens for a new conflict", async () => {
    upsertHostByName("mars", t0);
    const [a, b] = [1, 2].map(
      (n) =>
        db
          .insert(disk)
          .values({ alias: `K${n}` })
          .returning()
          .get().id,
    );
    const conflict = (offsetMs: number) =>
      addAutoEvent({
        subjectType: "disk",
        subjectId: a,
        eventType: "identity-conflict",
        title: `identity conflict with disk ${b}`,
        data: { diskIds: [a, b] },
        at: at(offsetMs),
      });

    conflict(0);
    await syncFaults(at(MINUTE_MS));
    const open = liveFault("identity-conflict", `${a}:${a},${b}`) as FaultRow;
    expect(open).toMatchObject({ state: "open", subjectId: a });

    performFaultAction(open.id, "acknowledge", { now: at(2 * MINUTE_MS) });
    await syncFaults(at(3 * MINUTE_MS));
    expect(faultsOf("identity-conflict")).toMatchObject([
      { state: "resolved", resolvedAt: at(2 * MINUTE_MS) },
    ]);

    conflict(HOUR_MS);
    await syncFaults(at(HOUR_MS));
    expect(faultsOf("identity-conflict")).toMatchObject([
      { state: "resolved" },
      { state: "open" },
    ]);
  });

  it("stays resolved when acknowledged after the same conflict recurred", async () => {
    const [a, b, c] = [1, 2, 3].map(
      (n) =>
        db
          .insert(disk)
          .values({ alias: `K${n}` })
          .returning()
          .get().id,
    );
    const conflict = (diskIds: number[], offsetMs: number) =>
      addAutoEvent({
        subjectType: "disk",
        subjectId: a,
        eventType: "identity-conflict",
        title: "identity conflict",
        data: { diskIds },
        at: at(offsetMs),
      });

    conflict([a, b], 0);
    await syncFaults(t0);
    conflict([a, b, c], MINUTE_MS);
    conflict([a, b], 2 * MINUTE_MS);
    await syncFaults(at(3 * MINUTE_MS));
    const pair = liveFault("identity-conflict", `${a}:${a},${b}`) as FaultRow;
    expect(pair.openedAt).toEqual(t0);

    performFaultAction(pair.id, "acknowledge", { now: at(4 * MINUTE_MS) });
    await syncFaults(at(5 * MINUTE_MS));

    expect(liveFault("identity-conflict", `${a}:${a},${b}`)).toBeUndefined();
  });
});

describe("disk-missing", () => {
  it("opens while the disk is missing", async () => {
    const mars = upsertHostByName("mars", t0);
    recordRun(mars.id, "lsblk", at(3 * DAY_MS));
    const diskId = db
      .insert(disk)
      .values({
        alias: "K2",
        lastSeenAt: t0,
        lastSeenHostId: mars.id,
        lastState: "spare",
      })
      .returning()
      .get().id;

    await syncFaults(at(3 * DAY_MS));

    expect(liveFault("disk-missing", String(diskId))).toMatchObject({
      data: { lastSeenAt: t0.toISOString() },
    });
  });

  it("skips a disposed disk and resolves its open fault as disposed", async () => {
    const mars = upsertHostByName("mars", t0);
    recordRun(mars.id, "lsblk", at(3 * DAY_MS));
    const insertMissing = (alias: string) =>
      db
        .insert(disk)
        .values({
          alias,
          lastSeenAt: t0,
          lastSeenHostId: mars.id,
          lastState: "spare",
        })
        .returning()
        .get().id;
    const k2 = insertMissing("K2");
    const k3 = insertMissing("K3");
    db.update(disk)
      .set({ disposal: { kind: "sold", on: "2026-09-02" } })
      .where(eq(disk.id, k3))
      .run();

    await syncFaults(at(3 * DAY_MS));
    expect(liveFault("disk-missing", String(k2))).toBeDefined();
    expect(faultsOf("disk-missing").map((row) => row.subjectId)).toEqual([k2]);

    db.update(disk)
      .set({ disposal: { kind: "rma", on: "2026-09-04" } })
      .where(eq(disk.id, k2))
      .run();
    await syncFaults(at(4 * DAY_MS));

    expect(faultsOf("disk-missing")).toMatchObject([
      { subjectId: k2, state: "resolved", resolvedAt: at(4 * DAY_MS) },
    ]);
    expect(
      faultEvents()
        .filter((entry) => entry.eventType === "fault-resolved")
        .map((entry) => entry.data.reason),
    ).toEqual(["disposed"]);
  });
});

describe("smart-attribute", () => {
  it("opens one fault per failing attribute and mirrors acceptances at once", async () => {
    ingestSmart(withAttributeRaw(SDB, 198, 0));
    const diskId = k2Id();
    await syncFaults(t0);
    const pending = liveFault("smart-attribute", `${diskId}:197`) as FaultRow;
    expect(pending).toMatchObject({
      state: "open",
      severity: "error",
      subjectType: "disk",
      data: { attrId: "197", value: 16 },
    });
    expect(faultEvents()).toEqual([]);

    acceptFault({
      diskId,
      attrId: "197",
      kind: "acknowledge",
      now: at(MINUTE_MS),
    });
    expect(liveFault("smart-attribute", `${diskId}:197`)?.state).toBe(
      "acknowledged",
    );

    performFaultAction(pending.id, "accept", {
      note: "stable",
      now: at(2 * MINUTE_MS),
    });
    expect(activeAcceptances(diskId).get("197")).toMatchObject({
      kind: "accept",
      note: "stable",
    });
    expect(liveFault("smart-attribute", `${diskId}:197`)).toMatchObject({
      state: "accepted",
      note: "stable",
    });

    performFaultAction(pending.id, "clear", { now: at(3 * MINUTE_MS) });
    expect(activeAcceptances(diskId).has("197")).toBe(false);
    expect(liveFault("smart-attribute", `${diskId}:197`)?.state).toBe("open");
  });

  it("reopens when an acknowledged value rises", async () => {
    ingestSmart(withAttributeRaw(SDB, 198, 0));
    const diskId = k2Id();
    await syncFaults(t0);
    const pending = liveFault("smart-attribute", `${diskId}:197`) as FaultRow;
    performFaultAction(pending.id, "acknowledge", { now: at(MINUTE_MS) });

    ingestSmart(
      withAttributeRaw(withAttributeRaw(SDB, 198, 0), 197, 17),
      at(HOUR_MS),
    );

    expect(liveFault("smart-attribute", `${diskId}:197`)).toMatchObject({
      id: pending.id,
      state: "open",
    });
    await syncFaults(at(HOUR_MS));
    expect(liveFault("smart-attribute", `${diskId}:197`)).toMatchObject({
      id: pending.id,
      state: "open",
      data: { value: 17 },
    });
  });

  it("resolves when the attribute passes or the disk leaves service", async () => {
    ingestSmart(SDB);
    const diskId = k2Id();
    await syncFaults(t0);
    expect(
      faultsOf("smart-attribute")
        .map((row) => row.data.attrId)
        .sort(),
    ).toEqual(["197", "198"]);

    ingestSmart(withAttributeRaw(SDB, 198, 0), at(HOUR_MS));
    await syncFaults(at(HOUR_MS));
    expect(liveFault("smart-attribute", `${diskId}:198`)).toBeUndefined();

    db.update(disk)
      .set({ stateOverride: "dead" })
      .where(eq(disk.id, diskId))
      .run();
    await syncFaults(at(2 * HOUR_MS));
    expect(
      faultsOf("smart-attribute").every((row) => row.state === "resolved"),
    ).toBe(true);
  });

  it("raises nothing for a disposed disk's failing attributes", async () => {
    ingestSmart(SDB);
    db.update(disk)
      .set({ disposal: { kind: "rma", on: "2026-09-01" } })
      .where(eq(disk.id, k2Id()))
      .run();

    await syncFaults(t0);

    expect(faultsOf("smart-attribute")).toEqual([]);
  });
});

describe("performFaultAction", () => {
  it("refuses actions the kind or state does not allow", async () => {
    const mars = upsertHostByName("mars", t0);
    recordRun(mars.id, "zpool-status", t0);
    db.update(host)
      .set({ collectorVersion: "0.1.0", collectorStatus: "incompatible" })
      .where(eq(host.id, mars.id))
      .run();
    await syncFaults(t0);
    const incompatible = faultsOf("collector-incompatible")[0];

    expectServiceError(
      () => performFaultAction(incompatible.id, "accept"),
      409,
    );
    expectServiceError(() => performFaultAction(incompatible.id, "clear"), 409);
    expectServiceError(() => performFaultAction(9999, "acknowledge"), 404);

    performFaultAction(incompatible.id, "acknowledge", { now: at(MINUTE_MS) });
    expectServiceError(
      () => performFaultAction(incompatible.id, "acknowledge"),
      409,
    );
    expect(
      performFaultAction(incompatible.id, "clear", { now: at(2 * MINUTE_MS) }),
    ).toMatchObject({ state: "open", note: "" });

    db.update(fault)
      .set({ state: "resolved", resolvedAt: at(3 * MINUTE_MS) })
      .where(eq(fault.id, incompatible.id))
      .run();
    expectServiceError(
      () => performFaultAction(incompatible.id, "acknowledge"),
      409,
    );
    expect(faultEvents().map((entry) => entry.data.to)).toEqual([
      "open",
      "acknowledged",
      "open",
    ]);
  });
});

describe("listFaults", () => {
  it("filters and counts by state", async () => {
    const mars = upsertHostByName("mars", t0);
    const venus = upsertHostByName("venus", t0);
    recordRun(venus.id, "zpool-status", t0);
    db.update(host)
      .set({ collectorVersion: "0.3.0", collectorStatus: "outdated" })
      .where(eq(host.id, venus.id))
      .run();
    const vault = insertPool(venus.id, "DEGRADED", t0);
    await syncFaults(t0);
    const degraded = liveFault("pool-degraded", String(vault.id)) as FaultRow;
    performFaultAction(degraded.id, "accept", { now: at(MINUTE_MS) });

    const live = listFaults({ state: ["open", "acknowledged"] });
    expect(live.faults.map((row) => row.kind)).toEqual([
      "collector-silent",
      "collector-outdated",
    ]);
    expect(live.counts).toEqual({
      open: 2,
      acknowledged: 0,
      accepted: 1,
      resolved: 0,
    });
    expect(live.faults[0].subject).toEqual({
      type: "host",
      id: mars.id,
      label: "mars",
      hostName: "mars",
    });

    const onVenus = listFaults({ state: ["accepted"], host: "venus" });
    expect(onVenus.faults).toMatchObject([
      { kind: "pool-degraded", subject: { label: "vault", hostName: "venus" } },
    ]);
    expect(onVenus.counts).toMatchObject({ open: 1, accepted: 1 });

    expect(
      listFaults({ state: ["open"], severity: "warning" }).faults,
    ).toMatchObject([{ kind: "collector-outdated" }]);
    expect(
      listFaults({
        state: ["open", "accepted"],
        subject: { type: "pool", id: vault.id },
      }).faults,
    ).toMatchObject([{ kind: "pool-degraded" }]);
    expect(
      db
        .select()
        .from(fault)
        .where(and(eq(fault.category, "zfs")))
        .all(),
    ).toHaveLength(1);
  });
});
