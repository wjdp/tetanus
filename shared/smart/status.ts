export const ATTRIBUTE_STATUSES = ["passed", "warning", "failed"] as const;
export type AttributeStatus = (typeof ATTRIBUTE_STATUSES)[number];

export const DEVICE_STATUSES = [
  "passed",
  "warning",
  "failed",
  "unknown",
] as const;
export type DeviceStatus = (typeof DEVICE_STATUSES)[number];

const SEVERITY: Record<DeviceStatus, number> = {
  unknown: 0,
  passed: 1,
  warning: 2,
  failed: 3,
};

export function worstStatus(...statuses: DeviceStatus[]): DeviceStatus {
  return statuses.reduce<DeviceStatus>(
    (worst, status) => (SEVERITY[status] > SEVERITY[worst] ? status : worst),
    "unknown",
  );
}
