export const REPLICATION_DIRECTIONS = ["received", "manual"] as const;
export type ReplicationDirection = (typeof REPLICATION_DIRECTIONS)[number];

export const REPLICATION_STATUSES = [
  "ok",
  "late",
  "stalled",
  "learning",
  "gone",
  "archived",
] as const;
export type ReplicationStatus = (typeof REPLICATION_STATUSES)[number];

export const REPLICATION_ROLES = ["source", "target"] as const;
export type ReplicationRole = (typeof REPLICATION_ROLES)[number];

export const INTERVAL_SYNCS = 10;
export const MIN_INTERVAL_SYNCS = 3;
export const REPLICATION_SYNCS_PAGE = 100;
export const REPLICATION_LADDER_LIMIT = 200;

const HOUR_MS = 60 * 60 * 1000;

export interface ReplicationThresholds {
  lateFloorHours: number;
  lateFactor: number;
  stalledFloorHours: number;
  stalledFactor: number;
}

export const DEFAULT_REPLICATION_THRESHOLDS: ReplicationThresholds = {
  lateFloorHours: 3,
  lateFactor: 0.5,
  stalledFloorHours: 48,
  stalledFactor: 2,
};

/** Median gap between consecutive syncs, newest `INTERVAL_SYNCS` only. */
export function learntIntervalMs(syncTimes: readonly Date[]): number | null {
  const recent = [...syncTimes]
    .map((at) => at.getTime())
    .sort((a, b) => b - a)
    .slice(0, INTERVAL_SYNCS);
  if (recent.length < MIN_INTERVAL_SYNCS) return null;
  const gaps = recent
    .slice(1)
    .map((at, index) => (recent[index] ?? at) - at)
    .sort((a, b) => a - b);
  const middle = Math.floor(gaps.length / 2);
  const median =
    gaps.length % 2 === 1
      ? (gaps[middle] ?? 0)
      : ((gaps[middle - 1] ?? 0) + (gaps[middle] ?? 0)) / 2;
  return median > 0 ? median : null;
}

export interface ReplicationHealthInput {
  archived: boolean;
  gone: boolean;
  lastSyncAt: Date | null;
  intervalMs: number | null;
  referenceAt: Date;
}

export interface ReplicationHealth {
  status: ReplicationStatus;
  dueAt: Date | null;
  overdueMs: number | null;
}

export function replicationHealth(
  {
    archived,
    gone,
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
  if (gone) return health("gone");
  if (intervalMs === null || overdueMs === null) return health("learning");
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

export interface ReplicationEndpoint {
  host: { id: number; name: string; displayName: string | null };
  pool: { id: number; name: string };
  dataset: { id: number; name: string; present: boolean };
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

export interface DatasetReplication {
  id: number;
  role: ReplicationRole;
  status: ReplicationStatus;
}
