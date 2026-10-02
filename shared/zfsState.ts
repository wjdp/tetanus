export type ZfsStateColour = "success" | "warning" | "error";

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
