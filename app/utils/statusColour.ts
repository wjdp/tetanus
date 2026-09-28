import type { EffectiveDiskState } from "#shared/disk";
import type { DeviceStatus } from "#shared/smart/status";

export type StatusColour = "neutral" | "warning" | "error" | "success" | "info";

// Per docs/008: alarm (error) only for a failing state; passed is quiet.
export function deviceStatusColour(status: DeviceStatus): StatusColour {
  if (status === "failed") return "error";
  if (status === "warning") return "warning";
  return "neutral";
}

export function diskStateColour(
  state: EffectiveDiskState | null,
): StatusColour {
  switch (state) {
    case "missing":
    case "dead":
      return "error";
    case "in-use":
    case "spare":
    case "removed":
    case "sold":
    case "retired":
    case "unseen":
    case null:
      return "neutral";
  }
}

const POOL_STATE_COLOUR: Record<string, StatusColour> = {
  ONLINE: "neutral",
  DEGRADED: "warning",
  FAULTED: "error",
  UNAVAIL: "error",
  OFFLINE: "warning",
  REMOVED: "warning",
  SUSPENDED: "error",
};

export function zfsStateColour(state: string): StatusColour {
  return POOL_STATE_COLOUR[state] ?? "warning";
}

export function attributeTrendColour(
  trend: "new" | "stable" | "worsening" | "improving",
): StatusColour {
  if (trend === "worsening") return "warning";
  if (trend === "improving") return "success";
  return "neutral";
}
