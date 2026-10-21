export const REPLICATION_DIRECTIONS = ["received", "manual"] as const;
export type ReplicationDirection = (typeof REPLICATION_DIRECTIONS)[number];

export const REPLICATION_STATUSES = [
  "ok",
  "late",
  "stalled",
  "learning",
  "target-gone",
  "source-gone",
  "archived",
] as const;
export type ReplicationStatus = (typeof REPLICATION_STATUSES)[number];

export const REPLICATION_ROLES = ["source", "target"] as const;
export type ReplicationRole = (typeof REPLICATION_ROLES)[number];

export const INTERVAL_SYNCS = 10;
export const REGULAR_GAPS = 4;
export const REGULAR_GAP_TOLERANCE = 0.25;
export const REPLICATION_SYNCS_PAGE = 100;
export const REPLICATION_LADDER_LIMIT = 200;

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

export interface ReplicationThresholds {
  lateFloorHours: number;
  lateFactor: number;
  stalledFloorHours: number;
  stalledFactor: number;
  maxIntervalDays: number;
}

export const DEFAULT_REPLICATION_THRESHOLDS: ReplicationThresholds = {
  lateFloorHours: 3,
  lateFactor: 0.5,
  stalledFloorHours: 48,
  stalledFactor: 2,
  maxIntervalDays: 60,
};

function median(sorted: readonly number[]): number {
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? (sorted[middle] ?? 0)
    : ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2;
}

function regularMedian(gaps: readonly number[]): number | null {
  const centre = median([...gaps].sort((a, b) => a - b));
  if (centre <= 0) return null;
  const regular = gaps.every(
    (gap) => Math.abs(gap - centre) <= REGULAR_GAP_TOLERANCE * centre,
  );
  return regular ? centre : null;
}

/**
 * Median gap of the newest run of regular syncs within the newest
 * `INTERVAL_SYNCS`; null until the newest `REGULAR_GAPS` gaps agree.
 */
export function learntIntervalMs(syncTimes: readonly Date[]): number | null {
  const recent = [...syncTimes]
    .map((at) => at.getTime())
    .sort((a, b) => b - a)
    .slice(0, INTERVAL_SYNCS);
  const gaps = recent.slice(1).map((at, index) => (recent[index] ?? at) - at);
  for (let length = gaps.length; length >= REGULAR_GAPS; length--) {
    const interval = regularMedian(gaps.slice(0, length));
    if (interval !== null) return interval;
  }
  return null;
}

export interface ReplicationHealthInput {
  archived: boolean;
  targetGone: boolean;
  sourceGone: boolean;
  lastSyncAt: Date | null;
  intervalMs: number | null;
  referenceAt: Date;
}

export interface ReplicationHealth {
  status: ReplicationStatus;
  dueAt: Date | null;
  overdueMs: number | null;
}

function learningHealth(
  lastSyncAt: Date | null,
  referenceAt: Date,
  thresholds: ReplicationThresholds,
): ReplicationHealth {
  const learning = {
    status: "learning",
    dueAt: null,
    overdueMs: null,
  } as const;
  if (!lastSyncAt) return learning;
  const dueAt = new Date(
    lastSyncAt.getTime() + thresholds.maxIntervalDays * DAY_MS,
  );
  const overdueMs = referenceAt.getTime() - dueAt.getTime();
  return overdueMs > 0 ? { status: "stalled", dueAt, overdueMs } : learning;
}

export function replicationHealth(
  {
    archived,
    targetGone,
    sourceGone,
    lastSyncAt,
    intervalMs,
    referenceAt,
  }: ReplicationHealthInput,
  thresholds: ReplicationThresholds,
): ReplicationHealth {
  const dueAt =
    lastSyncAt && intervalMs !== null
      ? new Date(lastSyncAt.getTime() + intervalMs)
      : null;
  const overdueMs = dueAt ? referenceAt.getTime() - dueAt.getTime() : null;
  const health = (status: ReplicationStatus) => ({ status, dueAt, overdueMs });
  if (archived) return health("archived");
  if (targetGone) return health("target-gone");
  if (sourceGone) return health("source-gone");
  if (intervalMs === null || overdueMs === null) {
    return learningHealth(lastSyncAt, referenceAt, thresholds);
  }
  const past = (floorHours: number, factor: number) =>
    overdueMs > Math.max(floorHours * HOUR_MS, factor * intervalMs);
  if (past(thresholds.stalledFloorHours, thresholds.stalledFactor)) {
    return health("stalled");
  }
  if (past(thresholds.lateFloorHours, thresholds.lateFactor)) {
    return health("late");
  }
  return health("ok");
}

export function replicationLabel({
  sourceName,
  targetName,
}: {
  sourceName: string | null;
  targetName: string;
}) {
  return sourceName ? `${sourceName} → ${targetName}` : targetName;
}

export interface ReplicationEndpoint {
  host: { id: number; name: string; displayName: string | null };
  pool: { id: number; name: string; path: string };
  dataset: { id: number; name: string; present: boolean };
}

export interface ReplicationEndpointFacts {
  pool: { state: string; displayState: string };
  dataset: {
    referenced: number;
    usedBySnapshots: number | null;
    available: number;
    compression: string | null;
    compressRatio: number | null;
    encryption: string | null;
    keyStatus: string | null;
    recordSize: number | null;
    mountpoint: string | null;
    creation: string;
  };
  snapshots: {
    count: number;
    newest: ReplicationLadderSnapshot | null;
  };
}

export interface ReplicationRow {
  id: number;
  source: ReplicationEndpoint | null;
  target: ReplicationEndpoint;
  direction: ReplicationDirection;
  status: ReplicationStatus;
  intervalSec: number | null;
  intervalManual: boolean;
  lastSyncAt: string | null;
  dueAt: string | null;
  overdueMs: number | null;
  syncCount: number;
  archivedAt: string | null;
  archivedNote: string;
}

export interface ReplicationSyncView {
  id: number;
  at: string;
  snapshotName: string | null;
  guid: string | null;
  snapshots: number;
}

export interface ReplicationLadderSnapshot {
  name: string;
  creation: string;
}

export interface ReplicationLadderRow {
  source: ReplicationLadderSnapshot | null;
  target: ReplicationLadderSnapshot | null;
  guid: string | null;
  creation: string;
}

export interface ReplicationPeer {
  host: { name: string; displayName: string | null };
  pool: string;
  dataset: string;
  sameHost: boolean;
}

export interface DatasetReplication {
  id: number;
  role: ReplicationRole;
  status: ReplicationStatus;
  /** The other end; null when a received replication's source is unknown. */
  peer: ReplicationPeer | null;
}
