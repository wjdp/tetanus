import type { AtaAttribute, SmartctlXallResult } from "#shared/smartctl";
import { type AttributeClass, attributeClass } from "./classification";
import {
  ATA_METADATA,
  type AtaAttributeMetadata,
  type AttributeMetadata,
  NVME_METADATA,
  type ObservedThreshold,
  SCSI_METADATA,
} from "./metadata";
import { type AttributeStatus, type DeviceStatus, worstStatus } from "./status";
import { transform } from "./transforms";

export interface EvaluatedAttribute {
  attrId: string;
  name: string;
  value: number;
  worst?: number;
  thresh?: number;
  rawValue?: number;
  rawString?: string;
  whenFailed?: string;
  transformedValue: number;
  attributeClass: AttributeClass;
  status: AttributeStatus;
  failureRate?: number;
  reason?: string;
}

export interface Evaluation {
  deviceStatus: DeviceStatus;
  attributes: EvaluatedAttribute[];
}

const NO_THRESHOLD = -1;

const REASONS = {
  failingNow: "Attribute is failing manufacturer SMART threshold",
  failedInPast: "Attribute has previously failed manufacturer SMART threshold",
  defectOverTen:
    "Observed failure rate for defect-class attribute is at least 10%",
  failingThreshold: "Attribute is failing recommended SMART threshold",
} as const;

class StatusAccumulator {
  status: AttributeStatus = "passed";
  private readonly reasons: string[] = [];

  raise(status: AttributeStatus, reason: string): void {
    this.status = worstStatus(this.status, status) as AttributeStatus;
    this.reasons.push(reason);
  }

  get reason(): string | undefined {
    return this.reasons.length > 0 ? this.reasons.join("; ") : undefined;
  }
}

function isFailingNow(whenFailed: string | null): boolean {
  const upper = whenFailed?.toUpperCase();
  return upper === "FAILING_NOW" || upper === "NOW";
}

function isFailedInPast(whenFailed: string | null): boolean {
  const upper = whenFailed?.toUpperCase();
  return upper === "IN_THE_PAST" || upper === "PAST";
}

function thresholdValue(
  metadata: AtaAttributeMetadata,
  attribute: AtaAttribute,
  transformedValue: number,
): number {
  if (metadata.displayType === "normalized") return attribute.value;
  return transformedValue;
}

function observedBucket(
  thresholds: readonly ObservedThreshold[] | undefined,
  value: number,
): ObservedThreshold | undefined {
  const containing = thresholds?.find(
    ({ low, high }) => low <= value && value <= high,
  );
  if (containing) return containing;
  const top = thresholds?.at(-1);
  return top && value > top.high ? top : undefined;
}

function validateObservedThresholds(
  metadata: AtaAttributeMetadata,
  attrClass: AttributeClass,
  value: number,
  accumulator: StatusAccumulator,
): number | undefined {
  const rate = observedBucket(
    metadata.observedThresholds,
    value,
  )?.annualFailureRate;
  if (attrClass === "defect" && rate !== undefined && rate >= 0.1) {
    accumulator.raise("failed", REASONS.defectOverTen);
  }
  return rate;
}

function evaluateAtaAttribute(attribute: AtaAttribute): EvaluatedAttribute {
  const attrId = String(attribute.id);
  const rawValue = attribute.raw.value ?? 0;
  const rawString = attribute.raw.string ?? "";
  const transformedValue = transform(
    attrId,
    attribute.value,
    rawValue,
    rawString,
  );
  const attrClass = attributeClass(attrId);
  const accumulator = new StatusAccumulator();
  let failureRate: number | undefined;

  if (isFailingNow(attribute.whenFailed)) {
    accumulator.raise("failed", REASONS.failingNow);
  } else {
    if (isFailedInPast(attribute.whenFailed)) {
      accumulator.raise("warning", REASONS.failedInPast);
    }
    const metadata = ATA_METADATA[attrId];
    if (metadata) {
      failureRate = validateObservedThresholds(
        metadata,
        attrClass,
        thresholdValue(metadata, attribute, transformedValue),
        accumulator,
      );
    }
  }

  return {
    attrId,
    name: attribute.name,
    value: attribute.value,
    worst: attribute.worst,
    thresh: attribute.thresh,
    ...(attribute.raw.value !== undefined ? { rawValue } : {}),
    ...(attribute.raw.string !== undefined ? { rawString } : {}),
    ...(attribute.whenFailed ? { whenFailed: attribute.whenFailed } : {}),
    transformedValue,
    attributeClass: attrClass,
    status: accumulator.status,
    ...(failureRate !== undefined ? { failureRate } : {}),
    ...(accumulator.reason ? { reason: accumulator.reason } : {}),
  };
}

function evaluateFixedThreshold(
  metadataTable: Readonly<Record<string, AttributeMetadata>>,
  attrId: string,
  value: number,
  thresh: number,
): EvaluatedAttribute {
  const metadata = metadataTable[attrId];
  const accumulator = new StatusAccumulator();
  if (thresh !== NO_THRESHOLD && metadata) {
    const breached =
      (metadata.ideal === "low" && value > thresh) ||
      (metadata.ideal === "high" && value < thresh);
    if (breached) accumulator.raise("failed", REASONS.failingThreshold);
  }
  return {
    attrId,
    name: metadata?.displayName ?? attrId,
    value,
    ...(thresh !== NO_THRESHOLD ? { thresh } : {}),
    transformedValue: value,
    attributeClass: thresh !== NO_THRESHOLD ? "defect" : "context",
    status: accumulator.status,
    ...(accumulator.reason ? { reason: accumulator.reason } : {}),
  };
}

type FixedThresholdRow = [attrId: string, value: unknown, thresh: number];

function evaluateFixedThresholds(
  metadataTable: Readonly<Record<string, AttributeMetadata>>,
  rows: FixedThresholdRow[],
): EvaluatedAttribute[] {
  return rows.flatMap(([attrId, value, thresh]) =>
    typeof value === "number"
      ? [evaluateFixedThreshold(metadataTable, attrId, value, thresh)]
      : [],
  );
}

function evaluateNvme(
  nvme: Record<string, unknown> | undefined,
): EvaluatedAttribute[] {
  const log = nvme ?? {};
  const field = (key: string) => log[key];
  const spareThreshold = log.availableSpareThreshold;
  const rows: FixedThresholdRow[] = [
    ["critical_warning", field("criticalWarning"), 0],
    ["temperature", field("temperature"), NO_THRESHOLD],
    [
      "available_spare",
      field("availableSpare"),
      typeof spareThreshold === "number" ? spareThreshold : NO_THRESHOLD,
    ],
    ["percentage_used", field("percentageUsed"), 100],
    ["data_units_read", field("dataUnitsRead"), NO_THRESHOLD],
    ["data_units_written", field("dataUnitsWritten"), NO_THRESHOLD],
    ["host_reads", field("hostReads"), NO_THRESHOLD],
    ["host_writes", field("hostWrites"), NO_THRESHOLD],
    ["controller_busy_time", field("controllerBusyTime"), NO_THRESHOLD],
    ["power_cycles", field("powerCycles"), NO_THRESHOLD],
    ["power_on_hours", field("powerOnHours"), NO_THRESHOLD],
    ["unsafe_shutdowns", field("unsafeShutdowns"), NO_THRESHOLD],
    ["media_errors", field("mediaErrors"), 0],
    ["num_err_log_entries", field("numErrLogEntries"), NO_THRESHOLD],
    ["warning_temp_time", field("warningTempTime"), NO_THRESHOLD],
    ["critical_comp_time", field("criticalCompTime"), NO_THRESHOLD],
  ];
  return evaluateFixedThresholds(NVME_METADATA, rows);
}

function evaluateScsi(scsi: SmartctlXallResult["scsi"]): EvaluatedAttribute[] {
  const rows: FixedThresholdRow[] = [
    ["scsi_grown_defect_list", scsi?.grownDefects, 0],
  ];
  for (const direction of ["read", "write", "verify"] as const) {
    const counters = scsi?.[direction];
    rows.push(
      [
        `${direction}_errors_corrected_by_eccfast`,
        counters?.errorsCorrectedByEccfast,
        NO_THRESHOLD,
      ],
      [
        `${direction}_errors_corrected_by_eccdelayed`,
        counters?.errorsCorrectedByEccdelayed,
        NO_THRESHOLD,
      ],
      [
        `${direction}_errors_corrected_by_rereads_rewrites`,
        counters?.errorsCorrectedByRereadsRewrites,
        NO_THRESHOLD,
      ],
      [
        `${direction}_total_errors_corrected`,
        counters?.totalErrorsCorrected,
        NO_THRESHOLD,
      ],
      [
        `${direction}_correction_algorithm_invocations`,
        counters?.correctionAlgorithmInvocations,
        NO_THRESHOLD,
      ],
      [
        `${direction}_total_uncorrected_errors`,
        counters?.totalUncorrectedErrors,
        0,
      ],
    );
  }
  return evaluateFixedThresholds(SCSI_METADATA, rows);
}

function evaluateAttributes(parsed: SmartctlXallResult): EvaluatedAttribute[] {
  switch (parsed.device.protocol) {
    case "ATA":
      return (parsed.ata?.attributes ?? []).map(evaluateAtaAttribute);
    case "NVMe":
      return evaluateNvme(parsed.nvme);
    case "SCSI":
      return evaluateScsi(parsed.scsi);
    default:
      return [];
  }
}

function overallHealth(parsed: SmartctlXallResult): DeviceStatus {
  if (
    parsed.smartStatus?.passed === false ||
    parsed.smartctl.exitStatus.diskFailing
  ) {
    return "failed";
  }
  return parsed.smartStatus ? "passed" : "unknown";
}

export function evaluateReading(parsed: SmartctlXallResult): Evaluation {
  if (parsed.standby) return { deviceStatus: "unknown", attributes: [] };

  const attributes = evaluateAttributes(parsed);
  const deviceStatus = worstStatus(
    overallHealth(parsed),
    ...attributes.map((attribute) => attribute.status),
  );
  return { deviceStatus, attributes };
}

/** Evaluates a raw count standing in for an ATA attribute the drive does not report. */
export function evaluateAtaRawCount(
  attrId: string,
  count: number,
): Pick<
  EvaluatedAttribute,
  "attributeClass" | "status" | "failureRate" | "reason"
> {
  const attrClass = attributeClass(attrId);
  const accumulator = new StatusAccumulator();
  const metadata = ATA_METADATA[attrId];
  const failureRate = metadata
    ? validateObservedThresholds(metadata, attrClass, count, accumulator)
    : undefined;
  return {
    attributeClass: attrClass,
    status: accumulator.status,
    ...(failureRate !== undefined ? { failureRate } : {}),
    ...(accumulator.reason ? { reason: accumulator.reason } : {}),
  };
}
