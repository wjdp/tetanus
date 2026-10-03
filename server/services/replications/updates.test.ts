import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "~~/server/database/client";
import {
  dataset,
  fault,
  pool,
  replication,
  replicationSync,
  snapshot,
} from "~~/server/database/schema";
import { listDiary } from "~~/server/services/diary";
import { syncFaults } from "~~/server/services/faults";
import { upsertHostByName } from "~~/server/services/hosts";
import { updateReplication } from "~~/server/services/replications";
import { ServiceError } from "~~/server/utils/serviceError";
import { flushDb } from "~~/test/db";

const t0 = new Date("2026-10-02T00:00:00Z");
const HOUR_MS = 60 * 60 * 1000;
const at = (hours: number) => new Date(t0.getTime() + hours * HOUR_MS);

let poolSeq = 0;

function insertDataset(hostName: string, name: string) {
  poolSeq += 1;
  const poolId = db
    .insert(pool)
    .values({
      hostId: upsertHostByName(hostName, t0).id,
      guid: `pool-${poolSeq}`,
      name: name.split("/")[0] ?? name,
      state: "ONLINE",
      firstSeenAt: t0,
      lastSeenAt: t0,
    })
    .returning()
    .get().id;
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

describe("updateReplication", () => {
  let tankA: number;
  let zetaA: number;
  let target: number;
  let id: number;

  beforeEach(() => {
    flushDb();
    tankA = insertDataset("mars", "tank/a");
    zetaA = insertDataset("mars", "zeta/a");
    target = insertDataset("vault", "vpool/tank/a");
    id = db
      .insert(replication)
      .values({
        sourceDatasetId: tankA,
        targetDatasetId: target,
        direction: "received",
        lastSyncAt: at(10),
        firstSeenAt: t0,
        lastSeenAt: t0,
      })
      .returning()
      .get().id;
    for (const hour of [8, 9, 10]) {
      db.insert(replicationSync)
        .values({ replicationId: id, at: at(hour), snapshots: 1 })
        .run();
    }
  });

  it("sets the source by hand, making the replication manual", () => {
    expect(
      updateReplication(id, { sourceDatasetId: zetaA }, at(11)),
    ).toMatchObject({
      direction: "manual",
      source: { dataset: { id: zetaA, name: "zeta/a" } },
    });
  });

  it("hands a cleared source back to discovery", () => {
    updateReplication(id, { sourceDatasetId: zetaA }, at(11));
    db.insert(snapshot)
      .values(
        [tankA, target].map((datasetId) => ({
          datasetId,
          name: "s1",
          guid: "7001",
          used: 0,
          referenced: 0,
          written: 0,
          creation: at(9),
          lastSeenAt: at(9),
        })),
      )
      .run();
    expect(
      updateReplication(id, { sourceDatasetId: null }, at(11)),
    ).toMatchObject({
      direction: "received",
      source: { dataset: { id: tankA } },
    });
  });

  it("refuses the target or an unknown dataset as source", () => {
    expect(() => updateReplication(id, { sourceDatasetId: target })).toThrow(
      ServiceError,
    );
    expect(() => updateReplication(id, { sourceDatasetId: 9999 })).toThrow(
      ServiceError,
    );
  });

  it("overrides the interval and clears the override", () => {
    expect(
      updateReplication(id, { manualIntervalSec: 86_400 }, at(11)),
    ).toMatchObject({ intervalSec: 86_400, intervalManual: true });
    expect(
      updateReplication(id, { manualIntervalSec: null }, at(11)),
    ).toMatchObject({ intervalSec: 3600, intervalManual: false });
  });

  it("archives with a note, resolving faults, then unarchives", async () => {
    await syncFaults(at(60), []);
    expect(updateReplication(id, {}, at(60)).faults).toEqual([
      expect.objectContaining({ kind: "replication-stalled", state: "open" }),
    ]);
    const archived = updateReplication(
      id,
      { archived: true, archivedNote: "moved off-site" },
      at(61),
    );
    expect(archived).toMatchObject({
      faults: [],
      status: "archived",
      archivedAt: at(61).toISOString(),
      archivedNote: "moved off-site",
    });
    expect(
      db
        .select()
        .from(fault)
        .where(eq(fault.subjectType, "replication"))
        .all()
        .map((row) => [row.state, row.data]),
    ).toEqual([["resolved", expect.any(Object)]]);

    expect(updateReplication(id, { archived: false }, at(62))).toMatchObject({
      archivedAt: null,
      archivedNote: "",
    });
    expect(
      listDiary({ subjectType: "replication", subjectId: id })
        .filter((entry) => entry.eventType?.startsWith("replication-"))
        .map((entry) => entry.title),
    ).toEqual([
      "Replication into vpool/tank/a unarchived",
      "Replication into vpool/tank/a archived: moved off-site",
    ]);
  });

  it("404s for an unknown replication", () => {
    expect(() => updateReplication(9999, { archived: true })).toThrow(
      ServiceError,
    );
  });
});
