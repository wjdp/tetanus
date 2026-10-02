import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "~~/server/database/client";
import {
  collectorRun,
  disk,
  fault,
  host,
  pool,
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
      data: { state: "DEGRADED", poolName: "vault" },
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

  it("resolves when the pool drops out of the host's latest zpool-status", async () => {
    const mars = upsertHostByName("mars", t0);
    const vault = insertPool(mars.id, "DEGRADED", t0);
    recordRun(mars.id, "zpool-status", t0);
    await syncFaults(t0);

    recordRun(mars.id, "zpool-status", at(10 * MINUTE_MS));
    await syncFaults(at(10 * MINUTE_MS));

    expect(faultsOf("pool-degraded")).toMatchObject([
      { key: String(vault.id), state: "resolved" },
    ]);
  });
});

describe("scan-errors", () => {
  it("stays until a clean scan", async () => {
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
    expect(liveFault("scan-errors", String(vault.id))).toMatchObject({
      data: { errors: 3, function: "SCRUB", poolName: "vault" },
    });

    scan(0, HOUR_MS);
    await syncFaults(at(HOUR_MS));
    expect(faultsOf("scan-errors")).toMatchObject([{ state: "resolved" }]);
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
  it("filters, counts by state and badges open errors", async () => {
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
    expect(live.badge).toBe(1);
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
