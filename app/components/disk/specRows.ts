import type { DriveSpec } from "#shared/drive-spec";

export interface SpecRow {
  label: string;
  value: string;
}

const BACKBLAZE_QUARTER = /^Backblaze thru Q\d \d{4}/;

const yesNo = (value: boolean | null) =>
  value === null ? null : value ? "Yes" : "No";

const withUnit = (value: number | null, unit: string) =>
  value === null ? null : `${value.toLocaleString("en-GB")} ${unit}`;

function failureRate(specs: DriveSpec): string | null {
  if (specs.afrPct === null) return null;
  const source =
    specs.reliabilitySource?.match(BACKBLAZE_QUARTER)?.[0] ??
    "Backblaze Drive Stats";
  return [
    `${Number(specs.afrPct.toFixed(2))} %`,
    withUnit(specs.reliabilityDriveCount, "drives"),
    source,
  ]
    .filter(Boolean)
    .join(" · ");
}

export function specRows(specs: DriveSpec): SpecRow[] {
  const all: { label: string; value: string | null }[] = [
    {
      label: "Line",
      value: specs.line ? `${specs.brand} ${specs.line}` : null,
    },
    { label: "Class", value: specs.driveClass },
    { label: "Cache", value: withUnit(specs.cacheMb, "MB") },
    { label: "TLER/ERC", value: yesNo(specs.ercTler) },
    { label: "NAND", value: specs.nandType },
    { label: "DRAM", value: yesNo(specs.hasDram) },
    { label: "PLP", value: yesNo(specs.hasPlp) },
    { label: "TBW", value: withUnit(specs.tbwTb, "TB") },
    { label: "DWPD", value: specs.dwpd?.toString() ?? null },
    {
      label: "Sustained write",
      value: withUnit(specs.sustainedWriteMbps, "MB/s"),
    },
    { label: "AFR", value: failureRate(specs) },
    { label: "In production", value: yesNo(specs.inProduction) },
    {
      label: "Also sold as",
      value: specs.alsoSoldAs.length ? specs.alsoSoldAs.join(", ") : null,
    },
  ];
  return all.filter((row): row is SpecRow => row.value !== null);
}

export function specFooter(specs: DriveSpec): string {
  return [
    specs.source === "local"
      ? "Specs: local override"
      : "Specs: nasdisks.com (CC BY 4.0) · Failure rates: Backblaze Drive Stats",
    specs.snapshot ? `snapshot ${specs.snapshot}` : null,
  ]
    .filter(Boolean)
    .join(" · ");
}
