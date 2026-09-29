export const VENDORS = [
  "seagate",
  "western-digital",
  "toshiba",
  "samsung",
  "intel",
  "hgst",
  "micron",
  "crucial",
  "kingston",
  "sandisk",
  "other",
] as const;

export type Vendor = (typeof VENDORS)[number];

export interface VendorEvidence {
  model?: string | null;
  wwn?: string | null;
  modelFamily?: string | null;
  brand?: string | null;
}

const MODEL_PREFIXES: readonly [RegExp, Vendor][] = [
  [/^ST\d/, "seagate"],
  [/^WDC /, "western-digital"],
  [/^WDS?\d/, "western-digital"],
  [/^WD /, "western-digital"],
  [/^TOSHIBA\b/, "toshiba"],
  [/^Samsung\b/i, "samsung"],
  [/^MZ[-A-Z0-9]/, "samsung"],
  [/^INTEL\b/, "intel"],
  [/^SSDSC2/, "intel"],
  [/^SSDPE/, "intel"],
  [/^HGST\b/, "hgst"],
  [/^Hitachi\b/, "hgst"],
  [/^HU[SH]\d/, "hgst"],
  [/^CT\d/, "crucial"],
  [/^Micron(?![A-Za-z])/i, "micron"],
  [/^MTFD/, "micron"],
  [/^KINGSTON\b/, "kingston"],
  [/^SanDisk\b/, "sandisk"],
];

const WWN_OUIS: Readonly<Record<string, Vendor>> = {
  "0004cf": "seagate",
  "000c50": "seagate",
  "0014ee": "western-digital",
  "000039": "toshiba",
  "0002c3": "samsung",
  "002538": "samsung",
  "001b21": "intel",
  "5cd2e4": "intel",
  "000cca": "hgst",
  "00a075": "micron",
};

const MODEL_FAMILY_PREFIXES: readonly [RegExp, Vendor][] = [
  [/^Seagate\b/i, "seagate"],
  [/^Western Digital\b/i, "western-digital"],
  [/^Toshiba\b/i, "toshiba"],
  [/^Samsung\b/i, "samsung"],
  [/^Intel\b/i, "intel"],
  [/^(?:HGST|Hitachi)\b/i, "hgst"],
  [/^Micron(?![A-Za-z])/i, "micron"],
  [/^Crucial\b/i, "crucial"],
  [/^Kingston\b/i, "kingston"],
  [/^SanDisk\b/i, "sandisk"],
];

const DATASET_BRANDS: Readonly<Record<string, Vendor>> = {
  seagate: "seagate",
  wd: "western-digital",
  "western digital": "western-digital",
  toshiba: "toshiba",
  samsung: "samsung",
  intel: "intel",
  hgst: "hgst",
  micron: "micron",
  crucial: "crucial",
  kingston: "kingston",
  sandisk: "sandisk",
};

function firstMatch(
  table: readonly [RegExp, Vendor][],
  text: string | null | undefined,
): Vendor | null {
  const trimmed = text?.trim();
  if (!trimmed) return null;
  return table.find(([pattern]) => pattern.test(trimmed))?.[1] ?? null;
}

function vendorFromWwn(wwn: string | null | undefined): Vendor | null {
  const normalised = wwn?.trim().toLowerCase().replace(/^0x/, "");
  if (!normalised || !/^[0-9a-f]{16}$/.test(normalised)) return null;
  return WWN_OUIS[normalised.slice(1, 7)] ?? null;
}

function vendorFromBrand(brand: string | null | undefined): Vendor | null {
  const trimmed = brand?.trim();
  if (!trimmed) return null;
  return DATASET_BRANDS[trimmed.toLowerCase()] ?? "other";
}

export function detectVendor({
  model,
  wwn,
  modelFamily,
  brand,
}: VendorEvidence): Vendor | null {
  return (
    firstMatch(MODEL_PREFIXES, model) ??
    vendorFromWwn(wwn) ??
    firstMatch(MODEL_FAMILY_PREFIXES, modelFamily) ??
    vendorFromBrand(brand)
  );
}
