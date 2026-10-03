import type { Vendor } from "../vendor";

const MIB = 1024 ** 2;
const GIB = 1024 ** 3;
const GB = 1000 ** 3;

const NAME_SUFFIX_UNITS: readonly [suffix: string, unitBytes: number][] = [
  ["_32MiB", 32 * MIB],
  ["_GiB", GIB],
  ["_GB", GB],
  ["_MiB", MIB],
];

const VENDOR_UNITS: readonly [
  vendor: Vendor,
  name: string,
  unitBytes: number,
][] = [["intel", "Total_LBAs_Written", 32 * MIB]];

const DEFAULT_LOGICAL_BLOCK_SIZE = 512;

export interface WrittenUnit {
  unitBytes: number;
  inferred: boolean;
}

export interface WrittenUnitContext {
  vendor: Vendor | null;
  logicalBlockSize: number | null;
}

export function writtenUnit(
  smartctlName: string,
  { vendor, logicalBlockSize }: WrittenUnitContext,
): WrittenUnit {
  const bySuffix = NAME_SUFFIX_UNITS.find(([suffix]) =>
    smartctlName.endsWith(suffix),
  );
  if (bySuffix) return { unitBytes: bySuffix[1], inferred: false };
  const byVendor = VENDOR_UNITS.find(
    ([ruleVendor, name]) => ruleVendor === vendor && name === smartctlName,
  );
  if (byVendor) return { unitBytes: byVendor[2], inferred: false };
  return {
    unitBytes: logicalBlockSize ?? DEFAULT_LOGICAL_BLOCK_SIZE,
    inferred: true,
  };
}
