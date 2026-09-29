const EXOS_LINES = [
  "Exos 7E10",
  "Exos 7E8",
  "Exos M",
  "Exos X10",
  "Exos X12",
  "Exos X14",
  "Exos X16",
  "Exos X18",
  "Exos X20",
  "Exos X22",
  "Exos X24",
];

const WD_ULTRASTAR_LINES = [
  "Ultrastar He8",
  "Ultrastar DC HC320",
  "Ultrastar DC HC330",
  "Ultrastar DC HC520",
  "Ultrastar DC HC530",
  "Ultrastar DC HC550",
  "Ultrastar DC HC560",
  "Ultrastar DC HC570",
  "Ultrastar DC HC580",
  "Ultrastar DC HC590",
];

const WD_BLACK_NVME_LINES = [
  "Black SN750",
  "Black SN770",
  "Black SN850X",
  "Black SN7100",
  "Black SN8100",
];

const TOSHIBA_ENTERPRISE_LINES = [
  "MG06",
  "MG07",
  "MG08",
  "MG09",
  "MG10",
  "MG11",
];

const SAMSUNG_FIVE_YEAR_LINES = [
  "850 EVO",
  "860 EVO",
  "870 EVO",
  "PM893",
  "PM9A3",
  "SM863a",
];

const INTEL_DC_LINES = ["DC S3510", "DC S3520", "DC S4610"];

function yearsFor(lines: readonly string[], years: number) {
  return lines.map((line) => [line, years] as const);
}

export const WARRANTY_YEARS_BY_LINE: Record<string, number> =
  Object.fromEntries([
    ...yearsFor(EXOS_LINES, 5),
    ["IronWolf Pro", 5],
    ["IronWolf", 3],
    ["BarraCuda", 2],
    ["SkyHawk", 3],
    ["Red Pro", 5],
    ["Gold", 5],
    ...yearsFor(WD_ULTRASTAR_LINES, 5),
    ["Red Plus", 3],
    ["Red", 3],
    ["Blue", 2],
    ...yearsFor(WD_BLACK_NVME_LINES, 5),
    ["Blue SN5000", 5],
    ...yearsFor(TOSHIBA_ENTERPRISE_LINES, 5),
    ["N300", 3],
    ...yearsFor(SAMSUNG_FIVE_YEAR_LINES, 5),
    ...yearsFor(INTEL_DC_LINES, 5),
  ]);

export function warrantyYearsFor(
  line: string | null | undefined,
): number | null {
  if (!line) return null;
  return Object.hasOwn(WARRANTY_YEARS_BY_LINE, line)
    ? (WARRANTY_YEARS_BY_LINE[line] as number)
    : null;
}

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

function addYears(isoDate: string, years: number): string | null {
  const parts = ISO_DATE.exec(isoDate);
  if (!parts) return null;
  const year = Number(parts[1]) + years;
  const month = Number(parts[2]);
  const lastDayOfMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const day = Math.min(Number(parts[3]), lastDayOfMonth);
  return new Date(Date.UTC(year, month - 1, day)).toISOString().slice(0, 10);
}

export function warrantyDefault({
  purchaseDate,
  purchaseCondition,
  line,
}: {
  purchaseDate?: string | null;
  purchaseCondition?: string | null;
  line?: string | null;
}): string | null {
  if (!purchaseDate || purchaseCondition === "shucked") return null;
  const years = warrantyYearsFor(line);
  return years === null ? null : addYears(purchaseDate, years);
}
