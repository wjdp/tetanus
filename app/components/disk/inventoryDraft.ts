import {
  INVENTORY_FIELDS,
  type Inventory,
  type InventoryKey,
} from "#shared/inventory-fields";

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
