import type { Vendor } from "./vendor";

const VENDOR_PREFIXES: readonly { prefix: string; vendor: Vendor }[] = [
  { prefix: "Samsung SSD ", vendor: "samsung" },
  { prefix: "SAMSUNG ", vendor: "samsung" },
  { prefix: "WDC ", vendor: "western-digital" },
  { prefix: "TOSHIBA ", vendor: "toshiba" },
  { prefix: "INTEL ", vendor: "intel" },
  { prefix: "HGST ", vendor: "hgst" },
  { prefix: "Hitachi ", vendor: "hgst" },
  { prefix: "SanDisk ", vendor: "sandisk" },
  { prefix: "KINGSTON ", vendor: "kingston" },
  { prefix: "Micron ", vendor: "micron" },
  { prefix: "Crucial ", vendor: "crucial" },
];

const TRAILING_CAPACITY = /\s+\d+(?:\.\d+)?\s?(?:GB|TB|G|T)$/i;
const MODEL_CODE_WITH_VARIANT =
  /^(?=[A-Z0-9]*[A-Z])(?=[A-Z0-9]*\d)([A-Z0-9]{8,})-[A-Z0-9]{4,}$/i;

function collapseWhitespace(model: string | null | undefined): string | null {
  const collapsed = model?.trim().replace(/\s+/g, " ");
  return collapsed || null;
}

function stripVendorPrefix(model: string, vendor?: Vendor | null): string {
  const lower = model.toLowerCase();
  const match = VENDOR_PREFIXES.find(
    (candidate) =>
      (!vendor || candidate.vendor === vendor) &&
      lower.startsWith(candidate.prefix.toLowerCase()),
  );
  return match ? model.slice(match.prefix.length).trimStart() : model;
}

export function modelWithoutVendor(
  model: string | null | undefined,
): string | null {
  const collapsed = collapseWhitespace(model);
  if (!collapsed) return null;
  return stripVendorPrefix(collapsed) || null;
}

export function displayModel(
  model: string | null | undefined,
  vendor?: Vendor | null,
): string | null {
  const collapsed = collapseWhitespace(model);
  if (!collapsed) return null;
  return stripVendorPrefix(collapsed, vendor) || null;
}

export function bareModel(model: string | null | undefined): string | null {
  const withoutVendor = modelWithoutVendor(model);
  if (!withoutVendor) return null;
  const withoutCapacity = withoutVendor.replace(TRAILING_CAPACITY, "");
  const withoutVariant = withoutCapacity.replace(MODEL_CODE_WITH_VARIANT, "$1");
  return withoutVariant || null;
}
