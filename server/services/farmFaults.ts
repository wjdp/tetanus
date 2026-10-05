import { isDisposed, isHistoryState } from "#shared/disk";
import type { FaultData } from "#shared/faults";
import {
  farmIdentityMismatches,
  SMART_RESET_MIN_HOURS,
  smartResetHours,
} from "#shared/smart/farm";
import type { DiskSummary } from "~~/server/services/disks";
import type { Detection } from "~~/server/services/faults";

function worsened(
  previous: FaultData,
  resetHours: number | null,
  mismatches: string[],
) {
  const previousHours =
    typeof previous.resetHours === "number" ? previous.resetHours : 0;
  const previousMismatches = Array.isArray(previous.mismatches)
    ? previous.mismatches
    : [];
  return (
    (resetHours ?? 0) > previousHours + SMART_RESET_MIN_HOURS ||
    mismatches.some((field) => !previousMismatches.includes(field))
  );
}

export function detectSmartCountersReset({
  disks,
}: {
  disks: DiskSummary[];
}): Detection[] {
  return disks.flatMap((row): Detection[] => {
    const farm = row.latestFarm;
    if (!farm || isHistoryState(row.state) || isDisposed(row)) return [];
    const resetHours = smartResetHours(farm, row.latestPowerOnHours);
    const mismatches = farmIdentityMismatches(farm, {
      serial: row.serial,
      wwns: row.keys
        .filter((key) => key.kind === "wwn")
        .map((key) => key.value),
    });
    if (resetHours === null && mismatches.length === 0) return [];
    return [
      {
        kind: "smart-counters-reset",
        key: String(row.id),
        subjectId: row.id,
        severity: "warning",
        data: {
          farmHours: farm.powerOnHours ?? null,
          smartHours: row.latestPowerOnHours,
          resetHours,
          mismatches,
        },
        reopen: (previous) => worsened(previous, resetHours, mismatches),
      },
    ];
  });
}
