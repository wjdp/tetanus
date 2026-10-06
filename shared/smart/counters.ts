import type { AtaSsdAttributes } from "./ataSsdAttributes";
import {
  type AcceptedLevel,
  type AttributeDisplayStatus,
  type AttributeStatus,
  overlayStatus,
} from "./status";

export interface CounterAttribute {
  attrId: string;
  value: number | null;
  transformedValue: number;
  status: AttributeStatus;
}

export interface StatusCounter {
  value: number;
  status: AttributeDisplayStatus;
}

export interface DiskCounters {
  reallocated: StatusCounter | null;
  pending: StatusCounter | null;
  uncorrectable: StatusCounter | null;
  wearPercent: StatusCounter | null;
  bytesWritten: number | null;
  bytesWrittenInferred: boolean;
}

export const NO_COUNTERS: DiskCounters = {
  reallocated: null,
  pending: null,
  uncorrectable: null,
  wearPercent: null,
  bytesWritten: null,
  bytesWrittenInferred: false,
};

export const NVME_DATA_UNIT_BYTES = 512_000;
export const WEAR_WARNING_PERCENT = 80;
export const WEAR_FAILED_PERCENT = 100;

const COUNTER_IDS = {
  ataReallocated: "5",
  ataPending: "197",
  ataUncorrectable: "198",
  nvmeMediaErrors: "media_errors",
  nvmeWear: "percentage_used",
  nvmeWritten: "data_units_written",
  scsiGrownDefects: "scsi_grown_defect_list",
  scsiReadUncorrected: "read_total_uncorrected_errors",
  scsiWriteUncorrected: "write_total_uncorrected_errors",
} as const;

export const COUNTER_ATTRIBUTE_IDS: readonly string[] =
  Object.values(COUNTER_IDS);

export function counterAttributeIds(
  ataSsdAttributes: AtaSsdAttributes | null,
): string[] {
  return [
    ...COUNTER_ATTRIBUTE_IDS,
    ...(ataSsdAttributes?.wear ? [ataSsdAttributes.wear] : []),
    ...(ataSsdAttributes?.written ? [ataSsdAttributes.written.attrId] : []),
  ];
}

const DISPLAY_SEVERITY: Record<AttributeDisplayStatus, number> = {
  passed: 0,
  accepted: 1,
  acknowledged: 2,
  warning: 3,
  failed: 4,
};

function worstDisplayStatus(
  ...statuses: AttributeDisplayStatus[]
): AttributeDisplayStatus {
  return statuses.reduce<AttributeDisplayStatus>(
    (worst, status) =>
      DISPLAY_SEVERITY[status] > DISPLAY_SEVERITY[worst] ? status : worst,
    "passed",
  );
}

export function countersFrom(
  rows: readonly CounterAttribute[],
  ataSsdAttributes: AtaSsdAttributes | null,
  acceptances: ReadonlyMap<string, AcceptedLevel>,
  percentageUsed: number | null = null,
): DiskCounters {
  const byId = new Map(rows.map((row) => [row.attrId, row]));

  const overlaid = (attrId: string): StatusCounter | null => {
    const row = byId.get(attrId);
    if (!row) return null;
    return {
      value: row.transformedValue,
      status: overlayStatus(
        row.status,
        row.transformedValue,
        acceptances.get(attrId),
      ),
    };
  };

  const summed = (...attrIds: string[]): StatusCounter | null => {
    const counters = attrIds.flatMap((attrId) => overlaid(attrId) ?? []);
    if (counters.length === 0) return null;
    return {
      value: counters.reduce((total, counter) => total + counter.value, 0),
      status: worstDisplayStatus(...counters.map((counter) => counter.status)),
    };
  };

  const ataWear = (): StatusCounter | null => {
    const wearId = ataSsdAttributes?.wear;
    const counter = wearId ? overlaid(wearId) : null;
    const row = wearId ? byId.get(wearId) : undefined;
    if (!counter || row?.value == null) return null;
    return {
      ...counter,
      value: percentageUsed ?? Math.max(0, 100 - row.value),
    };
  };

  const written = (): Pick<
    DiskCounters,
    "bytesWritten" | "bytesWrittenInferred"
  > => {
    const nvme = byId.get(COUNTER_IDS.nvmeWritten);
    if (nvme) {
      return {
        bytesWritten: nvme.transformedValue * NVME_DATA_UNIT_BYTES,
        bytesWrittenInferred: false,
      };
    }
    const ata = ataSsdAttributes?.written;
    const row = ata ? byId.get(ata.attrId) : undefined;
    if (!ata || !row)
      return { bytesWritten: null, bytesWrittenInferred: false };
    return {
      bytesWritten: row.transformedValue * ata.unitBytes,
      bytesWrittenInferred: ata.inferred,
    };
  };

  return {
    reallocated:
      overlaid(COUNTER_IDS.ataReallocated) ??
      overlaid(COUNTER_IDS.scsiGrownDefects),
    pending: overlaid(COUNTER_IDS.ataPending),
    uncorrectable:
      overlaid(COUNTER_IDS.ataUncorrectable) ??
      overlaid(COUNTER_IDS.nvmeMediaErrors) ??
      summed(COUNTER_IDS.scsiReadUncorrected, COUNTER_IDS.scsiWriteUncorrected),
    wearPercent: overlaid(COUNTER_IDS.nvmeWear) ?? ataWear(),
    ...written(),
  };
}
