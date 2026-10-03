import type {
  ReplicationSyncView,
  ReplicationThresholds,
} from "#shared/replications";

const HOUR_MS = 60 * 60 * 1000;

export type GapSeverity = "late" | "stalled" | null;

export interface SyncLogRow extends ReplicationSyncView {
  gapMs: number | null;
  gapSeverity: GapSeverity;
}

/**
 * A gap is marked as the status the replication would have had at the end of
 * it: late or stalled once it ran past the interval by the configured margin.
 */
export function gapSeverity(
  gapMs: number,
  intervalMs: number,
  thresholds: ReplicationThresholds,
): GapSeverity {
  const overdueMs = gapMs - intervalMs;
  const past = (floorHours: number, factor: number) =>
    overdueMs > Math.max(floorHours * HOUR_MS, factor * intervalMs);
  if (past(thresholds.stalledFloorHours, thresholds.stalledFactor)) {
    return "stalled";
  }
  if (past(thresholds.lateFloorHours, thresholds.lateFactor)) return "late";
  return null;
}

/**
 * Syncs newest first, each with the gap since the one before it. The oldest
 * row of a page has no gap: its predecessor is on the next page.
 */
export function syncLogRows(
  syncs: readonly ReplicationSyncView[],
  intervalSec: number | null,
  thresholds: ReplicationThresholds,
): SyncLogRow[] {
  return syncs.map((sync, index) => {
    const previous = syncs[index + 1];
    const gapMs = previous
      ? Date.parse(sync.at) - Date.parse(previous.at)
      : null;
    return {
      ...sync,
      gapMs,
      gapSeverity:
        gapMs === null || intervalSec === null
          ? null
          : gapSeverity(gapMs, intervalSec * 1000, thresholds),
    };
  });
}
