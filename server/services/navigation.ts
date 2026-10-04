import { and, count, eq, isNull, notInArray, or } from "drizzle-orm";
import { HISTORY_STATES } from "#shared/disk";
import type { NavigationCounts, StatusCounts } from "#shared/navigation";
import type { ReplicationStatus } from "#shared/replications";
import type { DeviceStatus } from "#shared/smart/status";
import { zfsStateColour } from "#shared/zfsState";
import { db } from "~~/server/database/client";
import { disk, fault, pool } from "~~/server/database/schema";
import {
  poolDisplayState,
  poolPresenceContext,
} from "~~/server/services/poolPresence";
import { listReplications } from "~~/server/services/replications";

const emptyCounts = (): StatusCounts => ({ error: 0, warning: 0, neutral: 0 });

const DEVICE_STATUS_BUCKET: Record<DeviceStatus, keyof StatusCounts> = {
  failed: "error",
  warning: "warning",
  passed: "neutral",
  unknown: "neutral",
};

const ZFS_COLOUR_BUCKET = {
  error: "error",
  warning: "warning",
  success: "neutral",
} as const satisfies Record<string, keyof StatusCounts>;

function faultCounts(): StatusCounts {
  const counts = emptyCounts();
  for (const row of db
    .select({ severity: fault.severity, total: count() })
    .from(fault)
    .where(eq(fault.state, "open"))
    .groupBy(fault.severity)
    .all()) {
    counts[row.severity] += row.total;
  }
  return counts;
}

function diskCounts(): StatusCounts {
  const counts = emptyCounts();
  for (const row of db
    .select({ status: disk.latestStatus, total: count() })
    .from(disk)
    .where(
      and(
        isNull(disk.disposal),
        or(
          isNull(disk.stateOverride),
          notInArray(disk.stateOverride, [...HISTORY_STATES]),
        ),
      ),
    )
    .groupBy(disk.latestStatus)
    .all()) {
    counts[DEVICE_STATUS_BUCKET[row.status]] += row.total;
  }
  return counts;
}

function poolCounts(now: Date): StatusCounts {
  const counts = emptyCounts();
  const presence = poolPresenceContext(now);
  for (const row of db
    .select({
      hostId: pool.hostId,
      lastSeenAt: pool.lastSeenAt,
      state: pool.state,
      archivedAt: pool.archivedAt,
    })
    .from(pool)
    .where(isNull(pool.archivedAt))
    .all()) {
    const colour = zfsStateColour(poolDisplayState(row, presence));
    counts[ZFS_COLOUR_BUCKET[colour]] += 1;
  }
  return counts;
}

const REPLICATION_STATUS_BUCKET: Partial<
  Record<ReplicationStatus, keyof StatusCounts>
> = {
  "target-gone": "error",
  stalled: "error",
  late: "warning",
  ok: "neutral",
  learning: "neutral",
  "source-gone": "neutral",
};

function replicationCounts(now: Date): StatusCounts {
  const counts = emptyCounts();
  for (const row of listReplications(now)) {
    const bucket = REPLICATION_STATUS_BUCKET[row.status];
    if (bucket) counts[bucket] += 1;
  }
  return counts;
}

export function navigationCounts(now = new Date()): NavigationCounts {
  return {
    faults: faultCounts(),
    disks: diskCounts(),
    pools: poolCounts(now),
    replications: replicationCounts(now),
  };
}
