import type { AtaSsdAttributes } from "./ataSsdAttributes";
import { WEAR_FAILED_PERCENT, WEAR_WARNING_PERCENT } from "./counters";
import type { DeviceStatistics } from "./deviceStatistics";
import type { EvaluatedAttribute } from "./evaluate";
import { type AttributeStatus, worstStatus } from "./status";

export const SPARE_WARNING_MARGIN = 10;

/** ATA reserved-space attributes, normalised so that lower means less spare left. */
export const ATA_RESERVED_SPACE_ATTRIBUTES = [
  "Available_Reservd_Space",
  "Available_Reserved_Space",
  "Used_Rsvd_Blk_Cnt_Tot",
  "Used_Rsvd_Blk_Cnt_Chip",
  "Unused_Rsvd_Blk_Cnt_Tot",
  "Unused_Rsvd_Blk_Ct_Chip",
  "Reserved_Block_Count",
] as const;

/** Program/erase failures and runtime bad blocks, by name since vendors reuse ids. */
export const ATA_DEFECT_ATTRIBUTES = [
  "Program_Fail_Cnt_Total",
  "Program_Fail_Count_Chip",
  "Program_Fail_Count",
  "Erase_Fail_Count_Total",
  "Erase_Fail_Count_Chip",
  "Erase_Fail_Count",
  "Runtime_Bad_Block",
] as const;

export const DEFECT_RISE_WINDOW_DAYS = 7;

export function isAtaDefectAttribute(name: string): boolean {
  return (ATA_DEFECT_ATTRIBUTES as readonly string[]).includes(name);
}

export function isAtaReservedSpaceAttribute(name: string): boolean {
  return (ATA_RESERVED_SPACE_ATTRIBUTES as readonly string[]).includes(name);
}

export function usablePercentageUsed(
  deviceStatistics: DeviceStatistics | null | undefined,
): number | null {
  const percentageUsed = deviceStatistics?.percentageUsed;
  return typeof percentageUsed === "number" &&
    !deviceStatistics?.normalised.includes("percentageUsed")
    ? percentageUsed
    : null;
}

export interface SsdPolicyContext {
  ataSsdAttributes: AtaSsdAttributes | null;
  /** Device statistic 7:8, when the drive reports it and does not flag it normalised. */
  percentageUsed: number | null;
  /** Attributes whose value rose within the defect window, this reading included. */
  risenAttrIds: ReadonlySet<string>;
}

export const NO_SSD_CONTEXT: SsdPolicyContext = {
  ataSsdAttributes: null,
  percentageUsed: null,
  risenAttrIds: new Set(),
};

const CRITICAL_WARNING_BITS = [
  "available spare below threshold",
  "temperature outside limits",
  "reliability degraded",
  "media read-only",
  "volatile memory backup failed",
] as const;

export function describeCriticalWarning(value: number): string[] {
  return CRITICAL_WARNING_BITS.filter((_, bit) => (value >> bit) & 1);
}

function wearStatus(percent: number): AttributeStatus {
  if (percent >= WEAR_FAILED_PERCENT) return "failed";
  if (percent >= WEAR_WARNING_PERCENT) return "warning";
  return "passed";
}

function raise(
  attribute: EvaluatedAttribute,
  status: AttributeStatus,
  reason: string,
): EvaluatedAttribute {
  const raised = worstStatus(attribute.status, status) as AttributeStatus;
  if (raised === attribute.status) return attribute;
  return { ...attribute, status: raised, reason };
}

function spareStatus(attribute: EvaluatedAttribute): EvaluatedAttribute {
  if (attribute.thresh === undefined || attribute.thresh < 0) return attribute;
  if (attribute.value > attribute.thresh + SPARE_WARNING_MARGIN) {
    return attribute;
  }
  return raise(
    attribute,
    "warning",
    `Spare ${attribute.value} within ${SPARE_WARNING_MARGIN} of threshold ${attribute.thresh}`,
  );
}

function adjust(
  attribute: EvaluatedAttribute,
  context: SsdPolicyContext,
): EvaluatedAttribute {
  const ssd = context.ataSsdAttributes;
  switch (attribute.attrId) {
    case "percentage_used":
      return raise(
        attribute,
        wearStatus(attribute.value),
        `${attribute.value} % of rated endurance used`,
      );
    case "available_spare":
      return spareStatus(attribute);
    case "critical_warning": {
      const bits = describeCriticalWarning(attribute.value);
      return bits.length > 0
        ? { ...attribute, reason: `Critical warning: ${bits.join(", ")}` }
        : attribute;
    }
  }
  if (ssd?.wear === attribute.attrId) {
    const percent = context.percentageUsed ?? 100 - attribute.value;
    return raise(
      attribute,
      wearStatus(percent),
      `${percent} % of rated endurance used`,
    );
  }
  if (ssd?.reserved?.includes(attribute.attrId)) return spareStatus(attribute);
  if (
    ssd?.defects?.includes(attribute.attrId) &&
    attribute.transformedValue > 0 &&
    context.risenAttrIds.has(attribute.attrId)
  ) {
    return raise(
      attribute,
      "warning",
      `Count ${attribute.transformedValue}, risen in the last ${DEFECT_RISE_WINDOW_DAYS} days`,
    );
  }
  return attribute;
}

/** Disk-aware SSD rules applied after the pure evaluation, identically at ingest and on policy reapplication. */
export function applySsdPolicy(
  attributes: EvaluatedAttribute[],
  context: SsdPolicyContext,
): EvaluatedAttribute[] {
  return attributes.map((attribute) => adjust(attribute, context));
}
