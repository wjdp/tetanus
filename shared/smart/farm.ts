import type { SeagateFarm } from "#shared/smartctl";

// FARM 3.x drives in the fleet read about 2× SMART power-on hours with spindle hours
// matching, which may be a counting difference rather than a reset (docs/083).
export const FARM_COMPARABLE_FROM_LOG_MAJOR = 4;
export const SMART_RESET_MIN_HOURS = 48;
const SMART_RESET_MIN_FRACTION = 0.05;
const SIXTEEN_BIT_WRAP = 65_536;

export type FarmIdentityField = "serial" | "wwn";

export function farmLogMajor(farm: SeagateFarm) {
  const major = Number.parseInt(farm.logVersion ?? "", 10);
  return Number.isNaN(major) ? null : major;
}

export function farmHoursComparable(farm: SeagateFarm) {
  const major = farmLogMajor(farm);
  return major !== null && major >= FARM_COMPARABLE_FROM_LOG_MAJOR;
}

function looksWrapped(farmHours: number, smartHours: number) {
  return (
    farmHours >= SIXTEEN_BIT_WRAP &&
    Math.abs((farmHours % SIXTEEN_BIT_WRAP) - smartHours) <=
      SMART_RESET_MIN_HOURS
  );
}

/** Hours FARM has counted that SMART no longer shows, when that is more than drift. */
export function smartResetHours(
  farm: SeagateFarm,
  smartHours: number | null,
): number | null {
  const farmHours = farm.powerOnHours;
  if (farmHours === undefined || smartHours === null) return null;
  if (!farmHoursComparable(farm)) return null;
  if (looksWrapped(farmHours, smartHours)) return null;
  const gap = farmHours - smartHours;
  const threshold = Math.max(
    SMART_RESET_MIN_HOURS,
    farmHours * SMART_RESET_MIN_FRACTION,
  );
  return gap > threshold ? gap : null;
}

export function farmIdentityMismatches(
  farm: SeagateFarm,
  drive: { serial: string | null; wwns: readonly string[] },
): FarmIdentityField[] {
  const mismatches: FarmIdentityField[] = [];
  if (farm.serial && drive.serial && farm.serial !== drive.serial.trim()) {
    mismatches.push("serial");
  }
  if (farm.wwn && drive.wwns.length > 0 && !drive.wwns.includes(farm.wwn)) {
    mismatches.push("wwn");
  }
  return mismatches;
}
