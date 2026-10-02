import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "~~/server/database/client";
import {
  collectorRun,
  disk,
  fault,
  pool,
  vdev,
} from "~~/server/database/schema";
import { listDiary } from "~~/server/services/diary";
import { syncFaults } from "~~/server/services/faults";
import { upsertHostByName } from "~~/server/services/hosts";
import { recordIngest } from "~~/server/services/ingest";
import {
  archivePool,
  getPool,
  listPools,
  unarchivePool,
} from "~~/server/services/zfs";
import { ServiceError } from "~~/server/utils/serviceError";
import { flushDb } from "~~/test/db";
import { readFixture } from "~~/test/fixtures";

const t0 = new Date("2026-09-01T10:00:00Z");
const MINUTE_MS = 60 * 1000;
const DAY_MS = 24 * 60 * MINUTE_MS;

const at = (offsetMs: number) => new Date(t0.getTime() + offsetMs);

function recordStatusRun(hostId: number, receivedAt: Date) {
  db.insert(collectorRun)
    .values({ hostId, source: "zpool-status", receivedAt, ok: true, bytes: 0 })
    .run();
}

function insertPool(hostId: number, state: string, seenAt: Date) {
  return db
    .insert(pool)
    .values({
      hostId,
      guid: "123",
      name: "tfault",
      state,
      firstSeenAt: seenAt,
      lastSeenAt: seenAt,
    })
    .returning()
    .get();
}

function insertLeaf(poolId: number, diskId: number | null) {
  db.insert(vdev)
    .values({
      poolId,
      guid: "13",
      name: "K3",
      type: "disk",
      state: "ONLINE",
      diskId,
      readErrors: 2,
      lastSeenAt: t0,
    })
    .run();
}

function liveFaults() {
  return db
    .select()
    .from(fault)
    .all()
    .filter((row) => row.resolvedAt === null);
}

const liveKinds = () =>
  liveFaults()
    .map((row) => row.kind)
    .sort();

function diaryOf(eventType: string) {
  return listDiary({ limit: 1000 }).filter(
    (entry) => entry.eventType === eventType,
  );
}

function expectServiceError(operation: () => unknown, statusCode: number) {
  expect(operation).toThrow(ServiceError);
  try {
    operation();
  } catch (error) {
    expect((error as ServiceError).statusCode).toBe(statusCode);
  }
}

beforeEach(() => {
  flushDb();
});

describe("archivePool", () => {
  it("records the archive with its note and hides the pool from the list", () => {
    const mars = upsertHostByName("mars", t0);
    const tfault = insertPool(mars.id, "ONLINE", t0);

    const archived = archivePool(tfault.id, "fixture capture", at(MINUTE_MS));

    expect(archived).toMatchObject({
      archivedAt: at(MINUTE_MS),
      archiveNote: "fixture capture",
    });
    expect(diaryOf("pool-archived")).toMatchObject([
      {
        subjectType: "pool",
        subjectId: tfault.id,
        title: "tfault archived: fixture capture",
        data: { note: "fixture capture" },
      },
    ]);
    expect(listPools()).toEqual([]);
    expect(listPools("include").map((row) => row.name)).toEqual(["tfault"]);
    expect(listPools("only").map((row) => row.name)).toEqual(["tfault"]);
    expect(getPool(tfault.id).name).toBe("tfault");
  });

  it("refuses to archive twice, unarchive a live pool, or touch a missing one", () => {
    const mars = upsertHostByName("mars", t0);
    const tfault = insertPool(mars.id, "ONLINE", t0);

    expectServiceError(() => unarchivePool(tfault.id), 409);
    archivePool(tfault.id);
    expectServiceError(() => archivePool(tfault.id), 409);
    expectServiceError(() => archivePool(99999), 404);
    expectServiceError(() => unarchivePool(99999), 404);
  });

  it("resolves the pool's live faults, leaf faults included, and detectors skip it", async () => {
    const mars = upsertHostByName("mars", t0);
    const tfault = insertPool(mars.id, "DEGRADED", t0);
    insertLeaf(tfault.id, null);
    recordStatusRun(mars.id, t0);
    await syncFaults(t0);
    expect(liveKinds()).toEqual(["leaf-errors", "pool-degraded"]);

    archivePool(tfault.id, "", at(MINUTE_MS));

    expect(liveFaults()).toEqual([]);
    expect(diaryOf("fault-resolved").map((entry) => entry.data.reason)).toEqual(
      ["archived", "archived"],
    );

    recordStatusRun(mars.id, at(10 * MINUTE_MS));
    await syncFaults(at(10 * MINUTE_MS));
    expect(liveKinds()).toEqual([]);
    expect(
      db.select().from(fault).where(eq(fault.kind, "pool-missing")).all(),
    ).toEqual([]);
  });

  it("lets faults re-detect once unarchived", async () => {
    const mars = upsertHostByName("mars", t0);
    const tfault = insertPool(mars.id, "DEGRADED", t0);
    recordStatusRun(mars.id, t0);
    archivePool(tfault.id, "", t0);
    await syncFaults(t0);
    expect(liveKinds()).toEqual([]);

    const unarchived = unarchivePool(tfault.id, at(MINUTE_MS));
    expect(unarchived).toMatchObject({ archivedAt: null, archiveNote: "" });
    expect(diaryOf("pool-unarchived")).toMatchObject([
      { title: "tfault unarchived" },
    ]);

    await syncFaults(at(MINUTE_MS));
    expect(liveKinds()).toEqual(["pool-degraded"]);
  });

  it("leaves disk-missing for a member disk to the disk", async () => {
    const mars = upsertHostByName("mars", t0);
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
    const tfault = insertPool(mars.id, "ONLINE", t0);
    insertLeaf(tfault.id, diskId);
    archivePool(tfault.id, "", t0);
    db.insert(collectorRun)
      .values({
        hostId: mars.id,
        source: "lsblk",
        receivedAt: at(3 * DAY_MS),
        ok: true,
        bytes: 0,
      })
      .run();
    recordStatusRun(mars.id, at(3 * DAY_MS));

    await syncFaults(at(3 * DAY_MS));

    expect(liveKinds()).toEqual(["disk-missing"]);
  });

  it("stays archived while ingest keeps updating the pool", () => {
    const body = readFixture("mars/zpool-status-stored-paths.json");
    const ingest = (receivedAt: Date) =>
      expect(
        recordIngest({
          hostName: "mars",
          source: "zpool-status",
          meta: {},
          body,
          receivedAt,
        }).ok,
      ).toBe(true);
    ingest(t0);
    const tank = db.select().from(pool).where(eq(pool.name, "tank")).get();
    if (!tank) throw new Error("tank not ingested");
    archivePool(tank.id, "", at(MINUTE_MS));

    ingest(at(10 * MINUTE_MS));

    expect(getPool(tank.id)).toMatchObject({
      archivedAt: at(MINUTE_MS),
      lastSeenAt: at(10 * MINUTE_MS),
    });
  });
});
