import { beforeEach, describe, expect, it } from "vitest";
import type { StateOverride } from "#shared/disk";
import type { FaultSeverity, FaultState } from "#shared/faults";
import type { DeviceStatus } from "#shared/smart/status";
import { db } from "~~/server/database/client";
import { collectorRun, disk, fault, pool } from "~~/server/database/schema";
import { upsertHostByName } from "~~/server/services/hosts";
import { navigationCounts } from "~~/server/services/navigation";
import { flushDb } from "~~/test/db";

const t0 = new Date("2026-09-01T10:00:00Z");
const MINUTE_MS = 60 * 1000;
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
) {
  db.insert(disk).values({ latestStatus, stateOverride }).run();
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

  it("buckets disks by SMART status, unknown as neutral, leaving history disks out", () => {
    insertDisk("failed");
    insertDisk("warning");
    insertDisk("warning", "spare");
    insertDisk("passed");
    insertDisk("unknown");
    insertDisk("failed", "dead");
    insertDisk("warning", "retired");
    insertDisk("passed", "sold");

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
});
