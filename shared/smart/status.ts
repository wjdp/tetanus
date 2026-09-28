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

export type AttributeDisplayStatus = AttributeStatus | "accepted";

const DISK_FAILING_EXIT_BIT = 1 << 3;

export interface AcceptedLevel {
  acceptedValue: number;
}

export interface OverlaidAttribute {
  attrId: string;
  status: AttributeStatus;
  transformedValue: number;
}

export function healthStatus(
  smartPassed: boolean | null,
  exitStatus: number | null,
): DeviceStatus {
  const diskFailing =
    exitStatus !== null && (exitStatus & DISK_FAILING_EXIT_BIT) !== 0;
  if (smartPassed === false || diskFailing) return "failed";
  return smartPassed === null ? "unknown" : "passed";
}

export function overlayStatus(
  status: AttributeStatus,
  transformedValue: number,
  acceptance: AcceptedLevel | null | undefined,
): AttributeDisplayStatus {
  if (!acceptance || status === "passed") return status;
  return transformedValue <= acceptance.acceptedValue ? "accepted" : status;
}

export function effectiveDeviceStatus(
  health: DeviceStatus,
  attributes: OverlaidAttribute[],
  active: ReadonlyMap<string, AcceptedLevel>,
): DeviceStatus {
  const unaccepted = attributes.flatMap((attribute) => {
    const display = overlayStatus(
      attribute.status,
      attribute.transformedValue,
      active.get(attribute.attrId),
    );
    return display === "accepted" ? [] : [display];
  });
  return worstStatus(health, ...unaccepted);
}
