import type { StatusColour } from "./colour";

export const ZFS_STATE_COLOUR: Record<string, StatusColour> = {
  ONLINE: "success",
  DEGRADED: "warning",
  OFFLINE: "warning",
  REMOVED: "warning",
  FAULTED: "error",
  UNAVAIL: "error",
  SUSPENDED: "error",
};

export function zfsStateColour(state: string): StatusColour {
  return Object.hasOwn(ZFS_STATE_COLOUR, state)
    ? ZFS_STATE_COLOUR[state]
    : "warning";
}
