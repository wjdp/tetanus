import type { SeagateFarm } from "#shared/smartctl";
import type {
  DeviceStatisticField,
  DeviceStatistics,
} from "./deviceStatistics";
import { type EvaluatedAttribute, evaluateAtaRawCount } from "./evaluate";
import { farmHoursComparable } from "./farm";

export type SubstituteSource = "device-statistics" | "farm";

export interface SubstituteAttribute
  extends Pick<
    EvaluatedAttribute,
    | "attrId"
    | "name"
    | "transformedValue"
    | "attributeClass"
    | "status"
    | "failureRate"
    | "reason"
  > {
  source: SubstituteSource;
}

interface DefectSubstitute {
  attrId: string;
  name: string;
  deviceStatistics: DeviceStatisticField[];
  farm: (errors: SeagateFarm["errors"]) => number | undefined;
}

const DEFECT_SUBSTITUTES: DefectSubstitute[] = [
  {
    attrId: "5",
    name: "Reallocated_Sector_Ct",
    deviceStatistics: ["reallocatedSectors"],
    farm: (errors) => errors.reallocatedSectors,
  },
  {
    attrId: "197",
    name: "Current_Pending_Sector",
    deviceStatistics: ["reallocationCandidates", "pendingErrors"],
    farm: (errors) => errors.reallocationCandidates,
  },
  {
    attrId: "187",
    name: "Reported_Uncorrect",
    deviceStatistics: ["reportedUncorrectables"],
    farm: ({ unrecoverableReads, unrecoverableWrites }) =>
      unrecoverableReads === undefined && unrecoverableWrites === undefined
        ? undefined
        : (unrecoverableReads ?? 0) + (unrecoverableWrites ?? 0),
  },
];

export const SUBSTITUTE_SOURCE_LABELS: Record<SubstituteSource, string> = {
  "device-statistics": "device statistics",
  farm: "FARM",
};

function deviceStatisticValue(
  statistics: DeviceStatistics | null | undefined,
  fields: DeviceStatisticField[],
) {
  if (!statistics) return undefined;
  return fields
    .filter((field) => !statistics.normalised.includes(field))
    .map((field) => statistics[field])
    .find((value) => value !== undefined);
}

function substituteValue(
  substitute: DefectSubstitute,
  statistics: DeviceStatistics | null | undefined,
  farm: SeagateFarm | null | undefined,
): { value: number; source: SubstituteSource } | undefined {
  const fromStatistics = deviceStatisticValue(
    statistics,
    substitute.deviceStatistics,
  );
  if (fromStatistics !== undefined) {
    return { value: fromStatistics, source: "device-statistics" };
  }
  if (!farm || !farmHoursComparable(farm)) return undefined;
  const fromFarm = substitute.farm(farm.errors);
  return fromFarm === undefined
    ? undefined
    : { value: fromFarm, source: "farm" };
}

/** Defect attributes missing from an ATA reading, filled from device statistics or FARM (docs/096). */
export function substituteDefects(
  presentAttrIds: ReadonlySet<string>,
  statistics: DeviceStatistics | null | undefined,
  farm: SeagateFarm | null | undefined,
): SubstituteAttribute[] {
  return DEFECT_SUBSTITUTES.flatMap((substitute) => {
    if (presentAttrIds.has(substitute.attrId)) return [];
    const found = substituteValue(substitute, statistics, farm);
    if (!found) return [];
    return {
      attrId: substitute.attrId,
      name: substitute.name,
      transformedValue: found.value,
      source: found.source,
      ...evaluateAtaRawCount(substitute.attrId, found.value),
    };
  });
}
