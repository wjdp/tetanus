import type { DriveSpec } from "#shared/drive-spec";
import { formatBytes } from "~/utils/format";

const BYTES_PER_TB = 1e12;
export const NOMINAL_SHORTFALL_THRESHOLD = 0.02;

const nominalFormat = new Intl.NumberFormat("en-GB", {
  maximumFractionDigits: 2,
});

export function formatNominalCapacity(capacityTb: number): string {
  return capacityTb < 1
    ? `${nominalFormat.format(capacityTb * 1000)} GB`
    : `${nominalFormat.format(capacityTb)} TB`;
}

export function nominalCapacityTb(
  capacityBytes: number | null,
  specs: Pick<DriveSpec, "capacityTb"> | null,
): number | null {
  const nominalTb = specs?.capacityTb ?? null;
  if (capacityBytes === null || nominalTb === null) return null;
  const nominalBytes = nominalTb * BYTES_PER_TB;
  const shortfall = (nominalBytes - capacityBytes) / nominalBytes;
  return shortfall > NOMINAL_SHORTFALL_THRESHOLD ? nominalTb : null;
}

export function capacityFact(
  capacityBytes: number | null,
  specs: Pick<DriveSpec, "capacityTb"> | null,
): string {
  const actual = formatBytes(capacityBytes);
  const nominalTb = nominalCapacityTb(capacityBytes, specs);
  return nominalTb === null
    ? actual
    : `${actual} (nominal ${formatNominalCapacity(nominalTb)})`;
}
