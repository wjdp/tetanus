const VENDOR_PREFIXES = [
  "Samsung SSD ",
  "SAMSUNG ",
  "WDC ",
  "TOSHIBA ",
  "INTEL ",
  "HGST ",
  "Hitachi ",
  "SanDisk ",
  "KINGSTON ",
  "Micron ",
  "Crucial ",
];

const TRAILING_CAPACITY = /\s+\d+(?:\.\d+)?\s?(?:GB|TB|G|T)$/i;
const MODEL_CODE_WITH_VARIANT =
  /^(?=[A-Z0-9]*[A-Z])(?=[A-Z0-9]*\d)([A-Z0-9]{8,})-[A-Z0-9]{4,}$/i;

function stripVendorPrefix(model: string): string {
  const lower = model.toLowerCase();
  const prefix = VENDOR_PREFIXES.find((candidate) =>
    lower.startsWith(candidate.toLowerCase()),
  );
  return prefix ? model.slice(prefix.length).trimStart() : model;
}

export function modelWithoutVendor(
  model: string | null | undefined,
): string | null {
  const collapsed = model?.trim().replace(/\s+/g, " ");
  if (!collapsed) return null;
  return stripVendorPrefix(collapsed) || null;
}

export function bareModel(model: string | null | undefined): string | null {
  const withoutVendor = modelWithoutVendor(model);
  if (!withoutVendor) return null;
  const withoutCapacity = withoutVendor.replace(TRAILING_CAPACITY, "");
  const withoutVariant = withoutCapacity.replace(MODEL_CODE_WITH_VARIANT, "$1");
  return withoutVariant || null;
}
