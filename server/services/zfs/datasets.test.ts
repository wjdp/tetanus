import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "~~/server/database/client";
import {
  dataset,
  datasetReading,
  diaryEntry,
  pool,
  snapshot,
} from "~~/server/database/schema";
import {
  parse as parseZfsList,
  type ZfsListResult,
} from "~~/server/ingest/zfs-list";
import {
  parse as parseZfsSnapshots,
  type ZfsSnapshotsResult,
} from "~~/server/ingest/zfs-snapshots";
import { upsertHostByName } from "~~/server/services/hosts";
import { flushDb } from "~~/test/db";
import { readFixture } from "~~/test/fixtures";
import { observeZfsList, observeZfsSnapshots } from "./datasets";

const T0 = new Date("2026-09-28T17:00:00Z");
const TANK_DATASETS = 80;
const TANK_SNAPSHOTS = 193;
const ZETA_SNAPSHOTS = 7;

function hoursAfter(hours: number) {
  return new Date(T0.getTime() + hours * 3_600_000);
}

function marsList(): ZfsListResult {
  return parseZfsList(readFixture("mars/zfs-list.json"), {}).data;
}

function marsSnapshots(): ZfsSnapshotsResult {
  return parseZfsSnapshots(readFixture("mars/zfs-snapshots.json"), {}).data;
}

function seedTank() {
  const hostId = upsertHostByName("mars", T0).id;
  const tank = db
    .insert(pool)
    .values({
      hostId,
      guid: "4620770592528249368",
      name: "tank",
      state: "ONLINE",
      firstSeenAt: T0,
      lastSeenAt: T0,
    })
    .returning()
    .get();
  return { hostId, tank };
}

function datasetNamed(name: string) {
  const row = db.select().from(dataset).where(eq(dataset.name, name)).get();
  if (!row) throw new Error(`dataset ${name} not stored`);
  return row;
}

function readingsOf(name: string) {
  return db
    .select()
    .from(datasetReading)
    .where(eq(datasetReading.datasetId, datasetNamed(name).id))
    .orderBy(datasetReading.id)
    .all();
}

function withoutDataset(data: ZfsListResult, name: string): ZfsListResult {
  return { datasets: data.datasets.filter((entry) => entry.name !== name) };
}

function withUsed(data: ZfsListResult, name: string, used: number) {
  return {
    datasets: data.datasets.map((entry) =>
      entry.name === name
        ? {
            ...entry,
            properties: {
              ...entry.properties,
              used: { ...entry.properties.used, value: used },
            },
          }
        : entry,
    ),
  };
}

beforeEach(() => {
  flushDb();
});

describe("observeZfsList", () => {
  it("stores tank datasets with parsed properties and skips unknown pools", () => {
    const { hostId, tank } = seedTank();
    const summary = observeZfsList(hostId, marsList(), T0);

    const rows = db.select().from(dataset).all();
    expect(rows).toHaveLength(TANK_DATASETS);
    expect(summary).toEqual({
      created: 0,
      destroyed: 0,
      skipped: marsList().datasets.length - TANK_DATASETS,
    });
    expect(datasetNamed("tank")).toMatchObject({
      poolId: tank.id,
      parentId: null,
      type: "filesystem",
      mountpoint: "/vol/tank",
      used: 73738833926736,
      compressRatio: 1.01,
      quota: null,
      refQuota: null,
      reservation: null,
      recordSize: 131072,
      compression: "lz4",
      encryption: "off",
      creation: new Date(1734889372 * 1000),
      present: true,
      firstSeenAt: T0,
      lastSeenAt: T0,
      snapshotCount: 0,
      latestSnapshotAt: null,
    });
  });

  it("resolves parents regardless of payload order", () => {
    const { hostId } = seedTank();
    const reversed = { datasets: [...marsList().datasets].reverse() };
    observeZfsList(hostId, reversed, T0);

    const deepest = datasetNamed("tank/anup07rl/t8a/diti/efs9el/yy");
    expect(deepest.parentId).toBe(
      datasetNamed("tank/anup07rl/t8a/diti/efs9el").id,
    );
    expect(datasetNamed("tank/delf/wmq54").parentId).toBe(
      datasetNamed("tank/delf").id,
    );
    expect(datasetNamed("tank/delf").parentId).toBe(datasetNamed("tank").id);
  });

  it("is idempotent", () => {
    const { hostId } = seedTank();
    observeZfsList(hostId, marsList(), T0);
    const first = db.select().from(dataset).orderBy(dataset.id).all();
    const summary = observeZfsList(hostId, marsList(), hoursAfter(1));
    const second = db.select().from(dataset).orderBy(dataset.id).all();

    expect(summary).toMatchObject({ created: 0, destroyed: 0 });
    expect(
      second.map((row) => [row.id, row.parentId, row.firstSeenAt]),
    ).toEqual(first.map((row) => [row.id, row.parentId, row.firstSeenAt]));
    expect(
      second.every(
        (row) => row.lastSeenAt.getTime() === hoursAfter(1).getTime(),
      ),
    ).toBe(true);
    expect(db.select().from(diaryEntry).all()).toEqual([]);
  });

  it("writes no diary entries on the first ingest of a pool", () => {
    const { hostId } = seedTank();
    observeZfsList(hostId, marsList(), T0);
    expect(db.select().from(diaryEntry).all()).toEqual([]);
  });

  it("flips present and records a destroyed dataset on the pool", () => {
    const { hostId, tank } = seedTank();
    observeZfsList(hostId, marsList(), T0);
    const summary = observeZfsList(
      hostId,
      withoutDataset(marsList(), "tank/delf/wmq54"),
      hoursAfter(1),
    );

    expect(summary).toMatchObject({ created: 0, destroyed: 1 });
    expect(datasetNamed("tank/delf/wmq54").present).toBe(false);
    expect(db.select().from(diaryEntry).all()).toMatchObject([
      {
        subjectType: "pool",
        subjectId: tank.id,
        kind: "auto",
        eventType: "dataset-destroyed",
        title: "dataset tank/delf/wmq54 destroyed",
        data: { datasetId: datasetNamed("tank/delf/wmq54").id },
        at: hoursAfter(1),
      },
    ]);
  });

  it("records a dataset appearing after the pool's first ingest", () => {
    const { hostId, tank } = seedTank();
    observeZfsList(hostId, withoutDataset(marsList(), "tank/delf/wmq54"), T0);
    const summary = observeZfsList(hostId, marsList(), hoursAfter(1));

    expect(summary).toMatchObject({ created: 1, destroyed: 0 });
    expect(datasetNamed("tank/delf/wmq54")).toMatchObject({
      present: true,
      parentId: datasetNamed("tank/delf").id,
      firstSeenAt: hoursAfter(1),
    });
    expect(db.select().from(diaryEntry).all()).toMatchObject([
      {
        subjectType: "pool",
        subjectId: tank.id,
        eventType: "dataset-created",
        title: "dataset tank/delf/wmq54 created",
      },
    ]);
  });

  it("keeps one reading per UTC day unless used moves more than 1 %", () => {
    const { hostId } = seedTank();
    const name = "tank/delf";
    const used = 25746410464;
    const plusHalfPercent = Math.round(used * 1.005);
    const plusTwoPercent = Math.round(used * 1.02);
    observeZfsList(hostId, marsList(), T0);
    expect(db.select().from(datasetReading).all()).toHaveLength(TANK_DATASETS);

    observeZfsList(
      hostId,
      withUsed(marsList(), name, plusHalfPercent),
      hoursAfter(1),
    );
    expect(readingsOf(name)).toHaveLength(1);

    observeZfsList(
      hostId,
      withUsed(marsList(), name, plusTwoPercent),
      hoursAfter(2),
    );
    expect(readingsOf(name).map((reading) => reading.used)).toEqual([
      used,
      plusTwoPercent,
    ]);
    expect(db.select().from(datasetReading).all()).toHaveLength(
      TANK_DATASETS + 1,
    );

    observeZfsList(
      hostId,
      withUsed(marsList(), name, plusTwoPercent),
      hoursAfter(8),
    );
    expect(readingsOf(name)).toHaveLength(3);
    expect(readingsOf(name).at(-1)?.at).toEqual(hoursAfter(8));
  });

  it("prunes readings older than 400 days", () => {
    const { hostId } = seedTank();
    observeZfsList(hostId, marsList(), T0);
    const later = new Date(T0.getTime() + 401 * 24 * 3_600_000);
    observeZfsList(hostId, marsList(), later);

    const readings = readingsOf("tank");
    expect(readings.map((reading) => reading.at)).toEqual([later]);
  });
});

describe("observeZfsSnapshots", () => {
  function seedDatasets() {
    const seeded = seedTank();
    observeZfsList(seeded.hostId, marsList(), T0);
    return seeded;
  }

  function snapshotsOf(name: string) {
    return db
      .select()
      .from(snapshot)
      .where(eq(snapshot.datasetId, datasetNamed(name).id))
      .orderBy(snapshot.creation)
      .all();
  }

  it("stores snapshots against their datasets and updates counts", () => {
    const { hostId } = seedDatasets();
    const data = marsSnapshots();
    const summary = observeZfsSnapshots(hostId, data, T0);

    expect(summary).toEqual({
      created: TANK_SNAPSHOTS,
      destroyed: 0,
      skipped: ZETA_SNAPSHOTS,
    });
    expect(db.select().from(snapshot).all()).toHaveLength(TANK_SNAPSHOTS);

    const utn = datasetNamed("tank/anup07rl/t8a/diti/utn");
    const utnSnapshots = snapshotsOf("tank/anup07rl/t8a/diti/utn");
    expect(utn.snapshotCount).toBe(50);
    expect(utnSnapshots).toHaveLength(50);
    expect(utn.latestSnapshotAt).toEqual(utnSnapshots.at(-1)?.creation);
    expect(datasetNamed("tank").snapshotCount).toBe(0);

    const first = snapshotsOf("tank/yoh6kfw").find(
      (row) => row.name === "syncoid_oth10_2024-01-09:23:37:26-GMT00:00",
    );
    expect(first).toMatchObject({
      guid: null,
      used: 1795024,
      referenced: 385706464,
      written: 385706464,
      creation: new Date(1704843446 * 1000),
      lastSeenAt: T0,
    });
  });

  it("is idempotent", () => {
    const { hostId } = seedDatasets();
    observeZfsSnapshots(hostId, marsSnapshots(), T0);
    const first = db.select().from(snapshot).orderBy(snapshot.id).all();
    const summary = observeZfsSnapshots(hostId, marsSnapshots(), hoursAfter(6));
    const second = db.select().from(snapshot).orderBy(snapshot.id).all();

    expect(summary).toEqual({
      created: 0,
      destroyed: 0,
      skipped: ZETA_SNAPSHOTS,
    });
    expect(second.map((row) => row.id)).toEqual(first.map((row) => row.id));
    expect(second[0].lastSeenAt).toEqual(hoursAfter(6));
  });

  it("deletes snapshots gone from the list and updates counts", () => {
    const { hostId } = seedDatasets();
    observeZfsSnapshots(hostId, marsSnapshots(), T0);
    const name = "tank/anup07rl/t8a/diti/utn";
    const doomed = snapshotsOf(name).at(-1);
    const data = marsSnapshots();
    data.snapshots = data.snapshots.filter(
      (entry) => !(entry.dataset === name && entry.snapshot === doomed?.name),
    );

    const summary = observeZfsSnapshots(hostId, data, hoursAfter(6));

    expect(summary).toEqual({
      created: 0,
      destroyed: 1,
      skipped: ZETA_SNAPSHOTS,
    });
    const remaining = snapshotsOf(name);
    expect(remaining).toHaveLength(49);
    expect(datasetNamed(name)).toMatchObject({
      snapshotCount: 49,
      latestSnapshotAt: remaining.at(-1)?.creation,
    });
  });

  it("zeroes counts when a dataset loses every snapshot", () => {
    const { hostId } = seedDatasets();
    observeZfsSnapshots(hostId, marsSnapshots(), T0);
    observeZfsSnapshots(hostId, { snapshots: [] }, hoursAfter(6));

    expect(db.select().from(snapshot).all()).toEqual([]);
    expect(datasetNamed("tank/wkws")).toMatchObject({
      snapshotCount: 0,
      latestSnapshotAt: null,
    });
  });

  it("skips and counts snapshots of unknown datasets", () => {
    const { hostId } = seedDatasets();
    const data = marsSnapshots();
    data.snapshots.push({
      ...data.snapshots[0],
      name: "tank/unknown@s1",
      dataset: "tank/unknown",
      snapshot: "s1",
    });
    expect(observeZfsSnapshots(hostId, data, T0)).toEqual({
      created: TANK_SNAPSHOTS,
      destroyed: 0,
      skipped: ZETA_SNAPSHOTS + 1,
    });
  });

  it("never overwrites a known guid with null", () => {
    const { hostId } = seedDatasets();
    const withGuids = marsSnapshots();
    withGuids.snapshots = withGuids.snapshots.map((entry, index) => ({
      ...entry,
      guid: `1774734222571039942${index}`,
    }));
    observeZfsSnapshots(hostId, withGuids, T0);
    observeZfsSnapshots(hostId, marsSnapshots(), hoursAfter(6));

    const guids = db.select({ guid: snapshot.guid }).from(snapshot).all();
    expect(
      guids.every((row) => row.guid?.startsWith("1774734222571039942")),
    ).toBe(true);
  });

  it("writes nothing to the diary", () => {
    const { hostId } = seedDatasets();
    observeZfsSnapshots(hostId, marsSnapshots(), T0);
    observeZfsSnapshots(hostId, { snapshots: [] }, hoursAfter(6));
    expect(db.select().from(diaryEntry).all()).toEqual([]);
  });
});
