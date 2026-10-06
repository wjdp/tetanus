import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "~~/server/database/client";
import {
  collectorRun,
  dataset,
  pool,
  replication,
  replicationSync,
  snapshot,
} from "~~/server/database/schema";
import { upsertHostByName } from "~~/server/services/hosts";
import {
  datasetReplications,
  getReplication,
  listReplications,
  replicationsOfDataset,
} from "~~/server/services/replications";
import { updateSettings } from "~~/server/services/settings";
import { ServiceError } from "~~/server/utils/serviceError";
import { flushDb } from "~~/test/db";

const t0 = new Date("2026-10-02T00:00:00Z");
const HOUR_MS = 60 * 60 * 1000;
const at = (hours: number) => new Date(t0.getTime() + hours * HOUR_MS);

let guidSeq = 0;

function insertPool(hostId: number, name: string) {
  guidSeq += 1;
  return db
    .insert(pool)
    .values({
      hostId,
      guid: `pool-${guidSeq}`,
      name,
      state: "ONLINE",
      firstSeenAt: t0,
      lastSeenAt: t0,
    })
    .returning()
    .get().id;
}

function insertDataset(poolId: number, name: string) {
  return db
    .insert(dataset)
    .values({
      poolId,
      name,
      type: "filesystem",
      used: 0,
      referenced: 0,
      available: 0,
      creation: t0,
      firstSeenAt: t0,
      lastSeenAt: t0,
    })
    .returning()
    .get().id;
}

function insertSnapshot(datasetId: number, name: string, guid: string | null) {
  const creation = at(Number(name.split("_").at(-1)));
  db.insert(snapshot)
    .values({
      datasetId,
      name,
      guid,
      used: 0,
      referenced: 0,
      written: 0,
      creation,
      lastSeenAt: creation,
    })
    .run();
}

function insertReplication(
  sourceDatasetId: number | null,
  targetDatasetId: number,
  syncHours: number[],
  extra: Partial<typeof replication.$inferInsert> = {},
) {
  const id = db
    .insert(replication)
    .values({
      sourceDatasetId,
      targetDatasetId,
      direction: "received",
      lastSyncAt: syncHours.length > 0 ? at(Math.max(...syncHours)) : null,
      firstSeenAt: t0,
      lastSeenAt: t0,
      ...extra,
    })
    .returning()
    .get().id;
  for (const hour of syncHours) {
    db.insert(replicationSync)
      .values({
        replicationId: id,
        at: at(hour),
        snapshotName: `syncoid_vault_${hour}`,
        snapshots: 1,
      })
      .run();
  }
  return id;
}

const hourly = (last: number) =>
  Array.from({ length: 5 }, (_, index) => last - index);

describe("replication health", () => {
  let vault: number;
  let tankA: number;
  let tank: number;
  let vpool: number;

  beforeEach(() => {
    flushDb();
    const mars = upsertHostByName("mars", t0).id;
    vault = upsertHostByName("vault", t0).id;
    tank = insertPool(mars, "tank");
    vpool = insertPool(vault, "vpool");
    tankA = insertDataset(tank, "tank/a");
  });

  const statusAt = (hours: number) =>
    listReplications(at(hours)).map((row) => row.status);

  it("goes ok, late, stalled as the next sync does not come", () => {
    insertReplication(tankA, insertDataset(vpool, "vpool/tank/a"), hourly(10));
    expect(statusAt(14)).toEqual(["ok"]);
    expect(statusAt(14.5)).toEqual(["late"]);
    expect(statusAt(59.5)).toEqual(["stalled"]);
  });

  it("reports the learnt interval, due time and overdue time", () => {
    insertReplication(tankA, insertDataset(vpool, "vpool/tank/a"), hourly(10));
    expect(listReplications(at(12))[0]).toMatchObject({
      intervalSec: 3600,
      intervalManual: false,
      lastSyncAt: at(10).toISOString(),
      dueAt: at(11).toISOString(),
      overdueMs: HOUR_MS,
      syncCount: 5,
      source: { host: { name: "mars" }, dataset: { name: "tank/a" } },
      target: {
        host: { name: "vault" },
        pool: { name: "vpool" },
        dataset: { name: "vpool/tank/a", present: true },
      },
    });
  });

  it("is learning with fewer than three syncs, unless the interval is set", () => {
    insertReplication(tankA, insertDataset(vpool, "vpool/tank/a"), [9, 10]);
    expect(statusAt(100)).toEqual(["learning"]);

    db.update(replication).set({ manualIntervalSec: 3600 }).run();
    expect(listReplications(at(100))[0]).toMatchObject({
      status: "stalled",
      intervalSec: 3600,
      intervalManual: true,
    });
  });

  it("freezes while the target host sends no history", () => {
    insertReplication(tankA, insertDataset(vpool, "vpool/tank/a"), hourly(10));
    db.insert(collectorRun)
      .values({
        hostId: vault,
        source: "zfs-receives",
        receivedAt: at(10.2),
        ok: true,
        bytes: 0,
      })
      .run();
    expect(statusAt(100)).toEqual(["ok"]);
  });

  const markAbsent = (datasetId: number) =>
    db
      .update(dataset)
      .set({ present: false })
      .where(eq(dataset.id, datasetId))
      .run();

  it("is source gone when the stored source is no longer present", () => {
    insertReplication(tankA, insertDataset(vpool, "vpool/tank/a"), hourly(10));
    markAbsent(tankA);
    expect(statusAt(100)).toEqual(["source-gone"]);
  });

  it("is target gone when the target is no longer present, even with the source gone", () => {
    const target = insertDataset(vpool, "vpool/tank/a");
    insertReplication(tankA, target, hourly(10));
    markAbsent(target);
    expect(statusAt(100)).toEqual(["target-gone"]);
    markAbsent(tankA);
    expect(statusAt(100)).toEqual(["target-gone"]);
  });

  it("is measured, not target gone, while the target pool is missing", () => {
    const target = insertDataset(vpool, "vpool/tank/a");
    insertReplication(tankA, target, hourly(10));
    markAbsent(target);
    db.insert(collectorRun)
      .values({
        hostId: vault,
        source: "zpool-status",
        receivedAt: at(99.9),
        ok: true,
        bytes: 0,
      })
      .run();
    expect(statusAt(100)).toEqual(["stalled"]);
  });

  it("is archived when marked so or when the target pool is archived", () => {
    const id = insertReplication(
      tankA,
      insertDataset(vpool, "vpool/tank/a"),
      hourly(10),
      { archivedAt: at(11) },
    );
    expect(statusAt(100)).toEqual(["archived"]);

    db.update(replication)
      .set({ archivedAt: null })
      .where(eq(replication.id, id))
      .run();
    db.update(pool)
      .set({ archivedAt: at(11) })
      .where(eq(pool.id, vpool))
      .run();
    expect(statusAt(100)).toEqual(["archived"]);
  });

  it("takes its thresholds from settings", async () => {
    insertReplication(tankA, insertDataset(vpool, "vpool/tank/a"), hourly(10));
    await updateSettings({ config: { replicationLateFloorHours: 1 } });
    expect(statusAt(12.5)).toEqual(["late"]);
  });
});

describe("replication detail", () => {
  let tankA: number;
  let vaultA: number;

  beforeEach(() => {
    flushDb();
    const mars = upsertHostByName("mars", t0).id;
    const vault = upsertHostByName("vault", t0).id;
    tankA = insertDataset(insertPool(mars, "tank"), "tank/a");
    vaultA = insertDataset(insertPool(vault, "vpool"), "vpool/tank/a");
  });

  it("pages syncs newest first", () => {
    const id = insertReplication(
      tankA,
      vaultA,
      Array.from({ length: 150 }, (_, hour) => hour),
    );
    const first = getReplication(id, {}, at(150));
    expect(first.syncs).toMatchObject({ total: 150, page: 1, pageSize: 100 });
    expect(first.syncs.items).toHaveLength(100);
    expect(first.syncs.items[0]?.at).toBe(at(149).toISOString());
    expect(getReplication(id, { page: 2 }, at(150)).syncs.items).toHaveLength(
      50,
    );
  });

  it("joins both sides' snapshots by guid into a ladder", () => {
    insertSnapshot(tankA, "autosnap_1", "11");
    insertSnapshot(tankA, "syncoid_vault_2", "12");
    insertSnapshot(tankA, "autosnap_3", "13");
    insertSnapshot(vaultA, "syncoid_vault_2", "12");
    insertSnapshot(vaultA, "unlisted_0", null);
    const id = insertReplication(tankA, vaultA, [2]);

    expect(
      getReplication(id, {}, at(3)).ladder.map((row) => [
        row.source?.name ?? null,
        row.target?.name ?? null,
        row.guid,
      ]),
    ).toEqual([
      ["autosnap_3", null, "13"],
      ["syncoid_vault_2", "syncoid_vault_2", "12"],
      ["autosnap_1", null, "11"],
      [null, "unlisted_0", null],
    ]);
  });

  it("is a 404 for an unknown replication", () => {
    expect(() => getReplication(999)).toThrow(ServiceError);
  });

  it("lists each dataset's replications with its role", () => {
    const id = insertReplication(tankA, vaultA, hourly(10));
    const byDataset = datasetReplications([tankA, vaultA], at(11));
    expect(byDataset.get(tankA)).toEqual([
      {
        id,
        role: "source",
        status: "ok",
        peer: {
          host: { name: "vault", displayName: null },
          pool: "vpool",
          dataset: "vpool/tank/a",
          sameHost: false,
        },
      },
    ]);
    expect(byDataset.get(vaultA)).toEqual([
      {
        id,
        role: "target",
        status: "ok",
        peer: {
          host: { name: "mars", displayName: null },
          pool: "tank",
          dataset: "tank/a",
          sameHost: false,
        },
      },
    ]);
  });

  it("lists a dataset's replications as list rows", () => {
    const id = insertReplication(tankA, vaultA, hourly(10));
    expect(replicationsOfDataset(tankA, at(11))).toMatchObject([
      { id, source: { dataset: { id: tankA } }, status: "ok" },
    ]);
    expect(replicationsOfDataset(vaultA, at(11)).map((row) => row.id)).toEqual([
      id,
    ]);
  });
});
