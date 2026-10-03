export type ZfsStateColour = "success" | "warning" | "error";

export const MISSING_POOL_STATE = "MISSING";

export const ZFS_STATE_COLOUR: Record<string, ZfsStateColour> = {
  ONLINE: "success",
  AVAIL: "success",
  INUSE: "success",
  DEGRADED: "warning",
  OFFLINE: "warning",
  REMOVED: "warning",
  FAULTED: "error",
  UNAVAIL: "error",
  SUSPENDED: "error",
  [MISSING_POOL_STATE]: "warning",
};

export function zfsStateColour(state: string): ZfsStateColour {
  return Object.hasOwn(ZFS_STATE_COLOUR, state)
    ? ZFS_STATE_COLOUR[state]
    : "warning";
}

export const VDEV_ROLES = [
  "normal",
  "log",
  "cache",
  "special",
  "dedup",
  "spare",
] as const;
export type VdevRole = (typeof VDEV_ROLES)[number];

export const LEAF_VDEV_TYPES: ReadonlySet<string> = new Set([
  "disk",
  "file",
  "dspare",
]);

export const DAMAGED_FILES_LIMIT = 100;

const HOUR_MS = 60 * 60 * 1000;
export const SCRUB_PAUSED_AFTER_MS = 24 * HOUR_MS;
export const SCAN_STALLED_AFTER_MS = 6 * HOUR_MS;
