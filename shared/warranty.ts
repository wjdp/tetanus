import type { Inventory } from "./inventory-fields";
import { warrantyDefault, warrantyYearsFor } from "./product-lines";

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
