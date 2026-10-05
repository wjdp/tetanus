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

export const ACCEPTANCE_KINDS = ["accept", "acknowledge"] as const;
export type AcceptanceKind = (typeof ACCEPTANCE_KINDS)[number];

export type AttributeDisplayStatus =
  | AttributeStatus
  | "accepted"
  | "acknowledged";

const DISK_FAILING_EXIT_BIT = 1 << 3;

export interface AcceptedLevel {
  kind: AcceptanceKind;
  acceptedValue: number;
}

const COVERED_STATUS = {
  accept: "accepted",
  acknowledge: "acknowledged",
} as const satisfies Record<AcceptanceKind, AttributeDisplayStatus>;

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

export function isCovered(acceptedValue: number, value: number): boolean {
  return value <= acceptedValue;
}

export function overlayStatus(
  status: AttributeStatus,
  transformedValue: number,
  acceptance: AcceptedLevel | null | undefined,
): AttributeDisplayStatus {
  if (!acceptance || status === "passed") return status;
  return isCovered(acceptance.acceptedValue, transformedValue)
    ? COVERED_STATUS[acceptance.kind]
    : status;
}

function deviceContribution(display: AttributeDisplayStatus): DeviceStatus[] {
  if (display === "accepted") return [];
  if (display === "acknowledged") return ["warning"];
  return [display];
}

export function effectiveDeviceStatus(
  health: DeviceStatus,
  attributes: OverlaidAttribute[],
  active: ReadonlyMap<string, AcceptedLevel>,
): DeviceStatus {
  const contributions = attributes.flatMap((attribute) =>
    deviceContribution(
      overlayStatus(
        attribute.status,
        attribute.transformedValue,
        active.get(attribute.attrId),
      ),
    ),
  );
  return worstStatus(health, ...contributions);
}

/** The drive's own SMART self-assessment, apart from tetanus's attribute checks. */
export interface SmartVerdict {
  drive: DeviceStatus;
  attributes: { failed: number; warning: number };
}
