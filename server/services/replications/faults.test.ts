import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "~~/server/database/client";
import {
  dataset,
  fault,
  pool,
  replication,
  replicationSync,
} from "~~/server/database/schema";
import { listDiary } from "~~/server/services/diary";
import { listFaults, syncFaults } from "~~/server/services/faults";
import { upsertHostByName } from "~~/server/services/hosts";
import { archivePool } from "~~/server/services/zfs";
import { flushDb } from "~~/test/db";

const t0 = new Date("2026-10-02T00:00:00Z");
const HOUR_MS = 60 * 60 * 1000;
const at = (hours: number) => new Date(t0.getTime() + hours * HOUR_MS);

const faults = () =>
  db
    .select()
    .from(fault)
    .where(eq(fault.subjectType, "replication"))
    .orderBy(fault.id)
    .all()
    .map((row) => ({
      kind: row.kind,
      severity: row.severity,
      state: row.state,
      data: row.data,
    }));

describe("replication faults", () => {
  let vpool: number;
  let replicationId: number;

  beforeEach(() => {
    flushDb();
    const mars = upsertHostByName("mars", t0).id;
    const vault = upsertHostByName("vault", t0).id;
    const insertPool = (hostId: number, name: string) =>
      db
        .insert(pool)
        .values({
          hostId,
          guid: name,
          name,
          state: "ONLINE",
          firstSeenAt: t0,
          lastSeenAt: t0,
        })
        .returning()
        .get().id;
    const insertDataset = (poolId: number, name: string) =>
      db
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
    const tankA = insertDataset(insertPool(mars, "tank"), "tank/a");
    vpool = insertPool(vault, "vpool");
    replicationId = db
      .insert(replication)
      .values({
        sourceDatasetId: tankA,
        targetDatasetId: insertDataset(vpool, "vpool/tank/a"),
        direction: "received",
        lastSyncAt: at(10),
        firstSeenAt: t0,
        lastSeenAt: t0,
      })
      .returning()
      .get().id;
    for (const hour of [8, 9, 10]) {
      db.insert(replicationSync)
        .values({ replicationId, at: at(hour), snapshots: 1 })
        .run();
    }
  });

  it("opens late, then stalled superseding late, then resolves on a sync", async () => {
    await syncFaults(at(12), []);
    expect(faults()).toEqual([]);

    await syncFaults(at(15), []);
    expect(faults()).toEqual([
      {
        kind: "replication-late",
        severity: "warning",
        state: "open",
        data: {
          targetName: "vpool/tank/a",
          sourceName: "tank/a",
          hostName: "vault",
          lastSyncAt: at(10).toISOString(),
          intervalSec: 3600,
        },
      },
    ]);

    await syncFaults(at(60), []);
    const [late, stalled] = db
      .select()
      .from(fault)
      .where(eq(fault.subjectType, "replication"))
      .orderBy(fault.id)
      .all();
    expect(late).toMatchObject({ kind: "replication-late", state: "resolved" });
    expect(stalled).toMatchObject({
      kind: "replication-stalled",
      severity: "error",
      state: "open",
    });
    expect(
      listDiary({ subjectType: "replication", subjectId: replicationId }).map(
        (entry) => [entry.eventType, entry.data.kind, entry.data.supersededBy],
      ),
    ).toEqual([
      [
        "fault-resolved",
        "replication-late",
        { kind: "replication-stalled", key: String(replicationId) },
      ],
      ["fault-opened", "replication-stalled", undefined],
      ["fault-opened", "replication-late", undefined],
    ]);

    db.update(replication)
      .set({ lastSyncAt: at(59.5) })
      .where(eq(replication.id, replicationId))
      .run();
    await syncFaults(at(60), []);
    expect(faults().map((row) => row.state)).toEqual(["resolved", "resolved"]);
  });

  it("describes the subject by source and target on the target host", async () => {
    await syncFaults(at(15), []);
    expect(
      listFaults({
        state: ["open"],
        subject: { type: "replication", id: replicationId },
      }).faults.map((view) => view.subject),
    ).toEqual([
      {
        type: "replication",
        id: replicationId,
        label: "tank/a → vpool/tank/a",
        hostName: "vault",
      },
    ]);
  });

  it("resolves an archived replication's faults with the reason", async () => {
    await syncFaults(at(60), []);
    db.update(replication)
      .set({ archivedAt: at(61) })
      .where(eq(replication.id, replicationId))
      .run();
    await syncFaults(at(62), []);
    expect(
      listDiary({ subjectType: "replication", subjectId: replicationId })[0]
        ?.data,
    ).toMatchObject({ kind: "replication-stalled", reason: "archived" });
    expect(faults().every((row) => row.state === "resolved")).toBe(true);
  });

  it("resolves the faults of replications into a pool being archived", async () => {
    await syncFaults(at(60), []);
    archivePool(vpool, "", at(61));
    expect(faults().every((row) => row.state === "resolved")).toBe(true);
    await syncFaults(at(62), []);
    expect(faults()).toEqual([
      expect.objectContaining({
        kind: "replication-stalled",
        state: "resolved",
      }),
    ]);
  });
});
