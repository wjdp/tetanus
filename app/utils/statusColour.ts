import type { EffectiveDiskState } from "#shared/disk";
import type { DeviceStatus } from "#shared/smart/status";
import {
  DEVICE_STATUS_VOCABULARY,
  LIFECYCLE_VOCABULARY,
  type StatusColour,
} from "./vocabulary";

export type { StatusColour } from "./vocabulary";
export { zfsStateColour } from "./vocabulary";

export function deviceStatusColour(status: DeviceStatus): StatusColour {
  return status === "passed"
    ? "neutral"
    : DEVICE_STATUS_VOCABULARY[status].colour;
}

export function diskStateColour(
  state: EffectiveDiskState | null,
): StatusColour {
  return state ? LIFECYCLE_VOCABULARY[state].colour : "neutral";
}

export function attributeTrendColour(
  trend: "new" | "stable" | "worsening" | "improving",
): StatusColour {
  if (trend === "worsening") return "warning";
  if (trend === "improving") return "success";
  return "neutral";
}
