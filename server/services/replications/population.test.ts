import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "~~/server/database/client";
import {
  dataset,
  pool,
  poolHistory,
  replication,
  replicationSync,
  snapshot,
} from "~~/server/database/schema";
import { listDiary } from "~~/server/services/diary";
import { upsertHostByName } from "~~/server/services/hosts";
import { recordIngest } from "~~/server/services/ingest";
import {
  backfillReplications,
  fillSyncGuids,
  resolveReplicationSources,
} from "~~/server/services/replications";
import { getSettings } from "~~/server/services/settings";
import { flushDb } from "~~/test/db";

const t0 = new Date("2026-10-02T05:00:00Z");
const HOUR_MS = 60 * 60 * 1000;
const at = (hours: number) => new Date(t0.getTime() + hours * HOUR_MS);

function historyTimestamp(date: Date) {
  return date.toISOString().slice(0, 19).replace("T", ".");
}

function receivesBody(poolName: string, lines: [Date, string][]) {
  return [
    `History for '${poolName}':`,
    ...lines.map(([when, text]) =>
      text.startsWith("finish")
        ? `${historyTimestamp(when)} [txg:1] ${text} [on vault]`
        : `${historyTimestamp(when)} ${text} [user 0 (root) on vault:linux]`,
    ),
  ].join("\n");
}

const hourlyPull = (target: string, hours: number[]) =>
  hours.flatMap((hour): [Date, string][] => [
    [
      at(hour),
      `finish receiving ${target}/%recv (1) snap=syncoid_vault_${hour}`,
    ],
    [at(hour), `zfs receive -s -F ${target}`],
  ]);

function ingestReceives(
  hostName: string,
  poolName: string,
  lines: [Date, string][],
  receivedAt: Date,
) {
  return recordIngest({
    hostName,
    source: "zfs-receives",
    meta: {},
    body: receivesBody(poolName, lines),
    receivedAt,
  });
}

let guidSeq = 0;

function insertPool(hostId: number, name: string, archivedAt?: Date) {
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
      archivedAt: archivedAt ?? null,
    })
    .returning()
    .get().id;
}

function insertDataset(
  poolId: number,
  name: string,
  { present = true, firstSeenAt = t0 } = {},
) {
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
      present,
      firstSeenAt,
      lastSeenAt: t0,
    })
    .returning()
    .get().id;
}

function insertSnapshot(
  datasetId: number,
  name: string,
  guid: string,
  creation: Date,
) {
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

const replicationOf = (targetDatasetId: number) =>
  db
    .select()
    .from(replication)
    .where(eq(replication.targetDatasetId, targetDatasetId))
    .get();

const syncsOf = (replicationId: number) =>
  db
    .select()
    .from(replicationSync)
    .where(eq(replicationSync.replicationId, replicationId))
    .orderBy(replicationSync.at)
    .all();

describe("replication population", () => {
  let mars: number;
  let vault: number;
  let tank: number;
  let zeta: number;
  let vpool: number;

  beforeEach(() => {
    flushDb();
    mars = upsertHostByName("mars", t0).id;
    vault = upsertHostByName("vault", t0).id;
    tank = insertPool(mars, "tank");
    zeta = insertPool(mars, "zeta");
    vpool = insertPool(vault, "vpool");
  });

  it("discovers a replication from receives into a present dataset", () => {
    const target = insertDataset(vpool, "vpool/tank/a");
    const outcome = ingestReceives(
      "vault",
      "vpool",
      hourlyPull("vpool/tank/a", [0, 1, 2]),
      at(2.5),
    );

    expect(outcome.ok).toBe(true);
    const row = replicationOf(target);
    expect(row).toMatchObject({
      direction: "received",
      sourceDatasetId: null,
      firstSeenAt: at(0),
      lastSyncAt: at(2),
      lastSeenAt: at(2.5),
    });
    expect(syncsOf(row?.id ?? 0).map((sync) => sync.at)).toEqual([
      at(0),
      at(1),
      at(2),
    ]);
    expect(
      listDiary({ subjectType: "replication" }).map((entry) => entry.title),
    ).toEqual(["Replication into vpool/tank/a discovered"]);
  });

  it("is idempotent over overlapping history", () => {
    const target = insertDataset(vpool, "vpool/tank/a");
    const lines = hourlyPull("vpool/tank/a", [0, 1, 2]);
    ingestReceives("vault", "vpool", lines, at(2.5));
    ingestReceives("vault", "vpool", lines, at(3));

    expect(syncsOf(replicationOf(target)?.id ?? 0)).toHaveLength(3);
    expect(listDiary({ subjectType: "replication" })).toHaveLength(1);
  });

  it("skips receives into an absent dataset or an archived pool", () => {
    insertDataset(zeta, "zeta/p.clone", { present: false });
    const old = insertPool(vault, "vold", at(-1));
    insertDataset(old, "vold/tank/a");
    ingestReceives(
      "mars",
      "zeta",
      [
        [at(0), "finish receiving zeta/p.clone (1949) snap=autosnap_old"],
        [at(0), "zfs receive -s -F zeta/p.clone"],
      ],
      at(1),
    );
    ingestReceives("vault", "vold", hourlyPull("vold/tank/a", [0]), at(1));

    expect(db.select().from(replication).all()).toEqual([]);
  });

  it("takes in a first backfill of history older than two days", () => {
    const target = insertDataset(vpool, "vpool/tank/a");
    ingestReceives(
      "vault",
      "vpool",
      hourlyPull("vpool/tank/a", [0, 24, 96]),
      at(97),
    );

    expect(syncsOf(replicationOf(target)?.id ?? 0)).toHaveLength(3);
  });

  it("fills a sync's guid from the target's snapshot, then or later", () => {
    const target = insertDataset(vpool, "vpool/tank/a");
    insertSnapshot(target, "syncoid_vault_0", "1000", at(0));
    ingestReceives(
      "vault",
      "vpool",
      hourlyPull("vpool/tank/a", [0, 1]),
      at(1.5),
    );
    const id = replicationOf(target)?.id ?? 0;
    expect(syncsOf(id).map((sync) => sync.guid)).toEqual(["1000", null]);

    insertSnapshot(target, "syncoid_vault_1", "1001", at(1));
    fillSyncGuids(at(2));
    expect(syncsOf(id).map((sync) => sync.guid)).toEqual(["1000", "1001"]);
  });

  it("resumes an archived replication on a newer sync", () => {
    const target = insertDataset(vpool, "vpool/tank/a");
    ingestReceives("vault", "vpool", hourlyPull("vpool/tank/a", [0]), at(0.5));
    db.update(replication)
      .set({ archivedAt: at(1), archivedNote: "moved" })
      .where(eq(replication.targetDatasetId, target))
      .run();
    ingestReceives(
      "vault",
      "vpool",
      hourlyPull("vpool/tank/a", [0, 2]),
      at(2.5),
    );

    expect(replicationOf(target)).toMatchObject({
      archivedAt: null,
      archivedNote: "",
    });
    expect(
      listDiary({ subjectType: "replication" }).map((entry) => entry.eventType),
    ).toEqual(["replication-resumed", "replication-discovered"]);
  });

  describe("source", () => {
    it("prefers a source that is not itself a target in a chain", () => {
      const zetaQ = insertDataset(zeta, "zeta/q");
      const copy = insertDataset(tank, "tank/copies/zeta/q");
      const vaultQ = insertDataset(vpool, "vpool/zeta/q");
      for (const datasetId of [zetaQ, copy]) {
        insertSnapshot(datasetId, "syncoid_vault_1", "2001", at(1));
      }
      for (const datasetId of [zetaQ, copy, vaultQ]) {
        insertSnapshot(datasetId, "syncoid_vault_2", "2002", at(2));
      }
      ingestReceives(
        "mars",
        "tank",
        hourlyPull("tank/copies/zeta/q", [1]),
        at(3),
      );
      ingestReceives("vault", "vpool", hourlyPull("vpool/zeta/q", [2]), at(3));

      expect(replicationOf(copy)?.sourceDatasetId).toBe(zetaQ);
      expect(replicationOf(vaultQ)?.sourceDatasetId).toBe(zetaQ);
    });

    it("prefers the newest common snapshot, then the longest known", () => {
      const target = insertDataset(vpool, "vpool/tank/a");
      const stale = insertDataset(zeta, "zeta/a");
      const fresh = insertDataset(tank, "tank/a", { firstSeenAt: at(1) });
      insertSnapshot(target, "s1", "3001", at(1));
      insertSnapshot(target, "s2", "3002", at(2));
      insertSnapshot(stale, "s1", "3001", at(1));
      insertSnapshot(fresh, "s2", "3002", at(2));
      ingestReceives("vault", "vpool", hourlyPull("vpool/tank/a", [2]), at(3));

      expect(replicationOf(target)?.sourceDatasetId).toBe(fresh);
    });

    it("never picks a dataset this target replicates into", () => {
      const original = insertDataset(tank, "tank/c");
      const backup = insertDataset(vpool, "vpool/tank/c");
      insertSnapshot(original, "s1", "4001", at(0));
      insertSnapshot(backup, "s1", "4001", at(0));
      ingestReceives("vault", "vpool", hourlyPull("vpool/tank/c", [0]), at(1));
      ingestReceives(
        "mars",
        "tank",
        hourlyPull("tank/c", [2]).map(([, text]) => [at(2), text]),
        at(3),
      );

      expect(replicationOf(backup)?.sourceDatasetId).toBe(original);
      expect(replicationOf(original)?.sourceDatasetId).toBeNull();
    });

    it("keeps a stored source while the common snapshots come and go", () => {
      const original = insertDataset(tank, "tank/a");
      const target = insertDataset(vpool, "vpool/tank/a");
      ingestReceives("vault", "vpool", hourlyPull("vpool/tank/a", [0]), at(1));
      expect(replicationOf(target)?.sourceDatasetId).toBeNull();

      insertSnapshot(original, "s1", "5001", at(0));
      insertSnapshot(target, "s1", "5001", at(0));
      expect(resolveReplicationSources()).toBe(1);
      db.delete(snapshot).where(eq(snapshot.datasetId, target)).run();
      expect(resolveReplicationSources()).toBe(0);

      expect(replicationOf(target)?.sourceDatasetId).toBe(original);
    });
  });

  it("backfills every host's stored history once", async () => {
    const target = insertDataset(vpool, "vpool/tank/a");
    const rows = hourlyPull("vpool/tank/a", [0, 1, 2]);
    db.insert(poolHistory)
      .values(
        rows.map(([when, text]) => ({
          hostId: vault,
          poolId: vpool,
          at: when,
          internal: text.startsWith("finish"),
          text,
        })),
      )
      .run();

    expect(backfillReplications(at(3))).toEqual({
      replications: 1,
      sources: 0,
    });
    expect(syncsOf(replicationOf(target)?.id ?? 0)).toHaveLength(3);
    expect((await getSettings()).config.replicationsBackfilledAt).toBe(
      at(3).toISOString(),
    );
  });
});
