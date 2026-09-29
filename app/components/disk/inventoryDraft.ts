import {
  INVENTORY_FIELDS,
  type Inventory,
  type InventoryKey,
} from "#shared/inventory-fields";
import { warrantyDefault, warrantyYearsFor } from "#shared/product-lines";

export type InventoryDraft = Record<
  InventoryKey,
  string | number | boolean | null
>;

export function draftFromInventory(
  inventory: Partial<Inventory>,
): InventoryDraft {
  return Object.fromEntries(
    INVENTORY_FIELDS.map((field) => [field.key, inventory[field.key] ?? null]),
  ) as InventoryDraft;
}

function blankToNull(value: string | number | boolean | null) {
  if (typeof value === "string" && value.trim() === "") return null;
  if (typeof value === "number" && Number.isNaN(value)) return null;
  return value;
}

export function inventoryFromDraft(draft: InventoryDraft): Inventory {
  return Object.fromEntries(
    INVENTORY_FIELDS.map((field) => {
      const value = blankToNull(draft[field.key]);
      if (field.type === "money" && typeof value === "string") {
        return [field.key, Number(value)];
      }
      return [field.key, value];
    }),
  ) as Inventory;
}

export interface WarrantySuggestion {
  date: string;
  text: string;
}

export function warrantySuggestion(
  draft: InventoryDraft,
  line: string | null | undefined,
): WarrantySuggestion | null {
  const years = warrantyYearsFor(line);
  const date = warrantyDefault({
    purchaseDate: stringOrNull(draft.purchaseDate),
    purchaseCondition: stringOrNull(draft.purchaseCondition),
    line,
  });
  if (draft.warrantyExpiry || years === null || date === null) return null;
  return { date, text: `${years} y from purchase → ${date} (${line} default)` };
}

const stringOrNull = (value: InventoryDraft[InventoryKey]) =>
  typeof value === "string" ? value : null;
