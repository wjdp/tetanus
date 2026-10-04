import type { Inventory } from "./inventory-fields";
import { warrantyDefault, warrantyYearsFor } from "./product-lines";

export type WarrantySource = "manufacturer" | "seller";

export interface EffectiveWarranty {
  expiry: string;
  source: WarrantySource;
}

export function effectiveWarranty(
  inventory: Partial<
    Pick<Inventory, "warrantyExpiry" | "sellerWarrantyExpiry">
  >,
): EffectiveWarranty | null {
  const manufacturer = inventory.warrantyExpiry ?? null;
  const seller = inventory.sellerWarrantyExpiry ?? null;
  if (seller && (!manufacturer || seller > manufacturer))
    return { expiry: seller, source: "seller" };
  return manufacturer ? { expiry: manufacturer, source: "manufacturer" } : null;
}

export interface WarrantySuggestion {
  date: string;
  text: string;
}

type WarrantyInputs = Partial<
  Pick<Inventory, "purchaseDate" | "purchaseCondition" | "warrantyExpiry">
>;

export function warrantySuggestion(
  inventory: WarrantyInputs,
  line: string | null | undefined,
): WarrantySuggestion | null {
  const years = warrantyYearsFor(line);
  const date = warrantyDefault({
    purchaseDate: inventory.purchaseDate,
    purchaseCondition: inventory.purchaseCondition,
    line,
  });
  if (inventory.warrantyExpiry || years === null || date === null) return null;
  return { date, text: `${years} y from purchase → ${date} (${line} default)` };
}
