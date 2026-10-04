import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import type { Disposal, StateOverride } from "#shared/disk";
import type { FaultSeverity, FaultState } from "#shared/faults";
import type { DeviceStatus } from "#shared/smart/status";
import { db } from "~~/server/database/client";
import {
  collectorRun,
  dataset,
  disk,
  fault,
  host,
  pool,
  replication,
  replicationSync,
} from "~~/server/database/schema";
import { upsertHostByName } from "~~/server/services/hosts";
import { navigationCounts } from "~~/server/services/navigation";
import { flushDb } from "~~/test/db";

const t0 = new Date("2026-09-01T10:00:00Z");
const MINUTE_MS = 60 * 1000;
const DAY_MS = 24 * 60 * MINUTE_MS;
const at = (offsetMs: number) => new Date(t0.getTime() + offsetMs);

let nextId = 1;

function insertFault(state: FaultState, severity: FaultSeverity) {
  const id = nextId++;
  db.insert(fault)
    .values({
      kind: "disk-missing",
      category: "disk",
      subjectType: "disk",
      subjectId: id,
      key: String(id),
      severity,
      openedAt: t0,
      lastSeenAt: t0,
      state,
      stateChangedAt: t0,
    })
    .run();
}

function insertDisk(
  latestStatus: DeviceStatus,
  stateOverride: StateOverride | null = null,
  disposal: Disposal | null = null,
) {
  db.insert(disk).values({ latestStatus, stateOverride, disposal }).run();
}

function insertPool(
  hostId: number,
  name: string,
  state: string,
  extra: Partial<typeof pool.$inferInsert> = {},
) {
  db.insert(pool)
    .values({
      hostId,
      guid: name,
      name,
      state,
      firstSeenAt: t0,
      lastSeenAt: t0,
      ...extra,
    })
    .run();
}

beforeEach(() => {
  flushDb();
});

describe("navigationCounts", () => {
  it("counts open faults by severity, ignoring acknowledged, accepted and resolved", () => {
    insertFault("open", "error");
    insertFault("open", "warning");
    insertFault("open", "warning");
    insertFault("acknowledged", "error");
    insertFault("accepted", "warning");
    insertFault("resolved", "error");

    expect(navigationCounts(t0).faults).toEqual({
      error: 1,
      warning: 2,
      neutral: 0,
    });
  });

  it("buckets hosts silent and incompatible red, outdated amber, offline intermittent neutral", () => {
    const hostWith = (
      name: string,
      extra: Partial<typeof host.$inferInsert>,
      lastRunAt: Date | null,
    ) => {
      const { id } = upsertHostByName(name, t0);
      db.update(host).set(extra).where(eq(host.id, id)).run();
      if (lastRunAt) {
        db.insert(collectorRun)
          .values({
            hostId: id,
            source: "zpool-status",
            receivedAt: lastRunAt,
            ok: true,
            bytes: 0,
          })
          .run();
      }
    };
    const recent = at(DAY_MS - MINUTE_MS);
    hostWith("current", { collectorStatus: "current" }, recent);
    hostWith("unknown", { collectorStatus: "unknown" }, recent);
    hostWith("outdated", { collectorStatus: "outdated" }, recent);
    hostWith("incompatible", { collectorStatus: "incompatible" }, recent);
    hostWith("silent", { collectorStatus: "current" }, t0);
    hostWith("asleep", { collectorStatus: "current", intermittent: true }, t0);

    expect(navigationCounts(at(DAY_MS)).hosts).toEqual({
      error: 2,
      warning: 1,
      neutral: 3,
    });
  });

  it("buckets disks by SMART status, unknown as neutral, leaving history and disposed disks out", () => {
    insertDisk("failed");
    insertDisk("warning");
    insertDisk("warning", "spare");
    insertDisk("passed");
    insertDisk("unknown");
    insertDisk("failed", "dead");
    insertDisk("warning", "retired");
    insertDisk("passed", null, { kind: "sold", on: "2026-08-01" });
    insertDisk("failed", "spare", { kind: "rma", on: "2026-08-01" });

    expect(navigationCounts(t0).disks).toEqual({
      error: 1,
      warning: 2,
      neutral: 2,
    });
  });

  it("buckets pools by display state, a missing pool amber, archived pools left out", () => {
    const mars = upsertHostByName("mars", t0);
    insertPool(mars.id, "tank", "ONLINE", { lastSeenAt: at(MINUTE_MS) });
    insertPool(mars.id, "zeta", "DEGRADED", { lastSeenAt: at(MINUTE_MS) });
    insertPool(mars.id, "tfault", "FAULTED", { lastSeenAt: at(MINUTE_MS) });
    insertPool(mars.id, "gone", "ONLINE");
    insertPool(mars.id, "old", "FAULTED", { archivedAt: t0 });
    db.insert(collectorRun)
      .values({
        hostId: mars.id,
        source: "zpool-status",
        receivedAt: at(MINUTE_MS),
        ok: true,
        bytes: 0,
      })
      .run();

    expect(navigationCounts(at(2 * MINUTE_MS)).pools).toEqual({
      error: 1,
      warning: 2,
      neutral: 1,
    });
  });

  it("buckets replications stalled and target gone red, late amber, archived left out", () => {
    const vault = upsertHostByName("vault", t0);
    const vpool = db
      .insert(pool)
      .values({
        hostId: vault.id,
        guid: "vpool",
        name: "vpool",
        state: "ONLINE",
        firstSeenAt: t0,
        lastSeenAt: t0,
      })
      .returning()
      .get().id;
    const HOUR_MS = 60 * MINUTE_MS;
    const insertReplication = (
      name: string,
      lastSyncHoursAgo: number,
      archivedAt: Date | null = null,
      present = true,
    ) => {
      const targetDatasetId = db
        .insert(dataset)
        .values({
          poolId: vpool,
          name,
          type: "filesystem",
          used: 0,
          referenced: 0,
          available: 0,
          creation: t0,
          firstSeenAt: t0,
          lastSeenAt: t0,
          present,
        })
        .returning()
        .get().id;
      const lastSyncAt = at(-lastSyncHoursAgo * HOUR_MS);
      const id = db
        .insert(replication)
        .values({
          targetDatasetId,
          direction: "received",
          lastSyncAt,
          archivedAt,
          firstSeenAt: t0,
          lastSeenAt: t0,
        })
        .returning()
        .get().id;
      for (const hour of [0, 1, 2]) {
        db.insert(replicationSync)
          .values({
            replicationId: id,
            at: new Date(lastSyncAt.getTime() - hour * HOUR_MS),
            snapshots: 1,
          })
          .run();
      }
    };
    insertReplication("vpool/a", 1);
    insertReplication("vpool/b", 5);
    insertReplication("vpool/c", 60);
    insertReplication("vpool/d", 60, t0);
    insertReplication("vpool/e", 1, null, false);

    expect(navigationCounts(t0).replications).toEqual({
      error: 2,
      warning: 1,
      neutral: 1,
    });
  });
});
