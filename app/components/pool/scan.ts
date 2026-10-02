import type { PoolLastScrub } from "#shared/schemas/pools";
import { SCAN_STALLED_AFTER_MS } from "#shared/zfsState";

export interface PoolScan {
  function: string;
  state: string;
  startTime: number;
  endTime?: number;
  examined: number;
  toExamine: number;
  processed?: number;
  issued?: number;
  pausedAt?: number;
  errors: number;
}

export interface ScanProgress {
  verb: string;
  percent: number;
  msLeft: number | null;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const INACTIVE_STATES = new Set(["FINISHED", "CANCELED", "NONE"]);

const STATE_LABELS: Record<string, string> = {
  SCANNING: "running",
  FINISHED: "finished",
  CANCELED: "cancelled",
  NONE: "none",
};

export function isScanActive(scan: PoolScan): boolean {
  return !INACTIVE_STATES.has(scan.state);
}

export function scanVerb(scan: PoolScan): string {
  return scan.function.toLowerCase();
}

export function scanStateLabel(scan: PoolScan): string {
  if (isScanActive(scan) && scan.pausedAt) return "paused";
  return STATE_LABELS[scan.state] ?? scan.state.toLowerCase();
}

export function scanProgress(scan: PoolScan, now: number): ScanProgress {
  const fraction = scan.toExamine > 0 ? scan.examined / scan.toExamine : 0;
  const elapsedMs = now - scan.startTime * 1000;
  const msLeft =
    !scan.pausedAt && fraction > 0 && fraction < 1 && elapsedMs > 0
      ? (elapsedMs * (1 - fraction)) / fraction
      : null;
  return {
    verb: scanVerb(scan),
    percent: Math.min(100, Math.floor(fraction * 100)),
    msLeft,
  };
}

export function scanEndedAt(scan: PoolScan): Date | null {
  return scan.endTime ? new Date(scan.endTime * 1000) : null;
}

export function scanStartedAt(scan: PoolScan): Date {
  return new Date(scan.startTime * 1000);
}

export function scanDurationMs(scan: PoolScan, now: number): number | null {
  if (scan.endTime) return (scan.endTime - scan.startTime) * 1000;
  return isScanActive(scan) ? now - scan.startTime * 1000 : null;
}

export function scanPausedAt(scan: PoolScan): Date | null {
  return isScanActive(scan) && scan.pausedAt
    ? new Date(scan.pausedAt * 1000)
    : null;
}

export function scanStalledSince(
  scan: PoolScan,
  progressAt: string | Date | null,
  now: number,
): Date | null {
  if (!isScanActive(scan) || scan.pausedAt || !progressAt) return null;
  const since = new Date(progressAt);
  return now - since.getTime() >= SCAN_STALLED_AFTER_MS ? since : null;
}

const isFinishedScrub = (scan: PoolScan | null): scan is PoolScan =>
  scan?.function === "SCRUB" && scan.state === "FINISHED" && !!scan.endTime;

export function lastScrubAt(
  scan: PoolScan | null,
  lastScrub: PoolLastScrub | null,
): number | null {
  const times = [
    ...(lastScrub ? [Date.parse(lastScrub.endAt)] : []),
    ...(isFinishedScrub(scan) ? [(scan.endTime ?? 0) * 1000] : []),
  ];
  return times.length ? Math.max(...times) : null;
}

export function isLastScrubCurrentScan(
  scan: PoolScan | null,
  lastScrub: PoolLastScrub,
): boolean {
  return (
    isFinishedScrub(scan) &&
    (scan.endTime ?? 0) * 1000 === Date.parse(lastScrub.endAt)
  );
}

export interface ScrubSchedule {
  scan: PoolScan | null;
  lastScrub: PoolLastScrub | null;
  firstSeenAt: string | Date;
  intervalDays: number;
}

// Mirrors the scrub-overdue detector: a never-scrubbed pool counts from when
// tetanus first saw it, and an interval of 0 turns the check off.
export function isScrubOverdue(schedule: ScrubSchedule, now: number): boolean {
  if (schedule.intervalDays <= 0) return false;
  const from =
    lastScrubAt(schedule.scan, schedule.lastScrub) ??
    new Date(schedule.firstSeenAt).getTime();
  return now - from > schedule.intervalDays * DAY_MS;
}
