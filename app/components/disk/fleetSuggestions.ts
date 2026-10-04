import type { Inventory, InventoryKey } from "#shared/inventory-fields";

export function fleetSuggestions(
  disks: readonly { inventory: Partial<Inventory> }[],
  key: InventoryKey,
): string[] {
  const values = disks.flatMap(({ inventory }) => {
    const value = inventory[key];
    if (Array.isArray(value)) return value;
    return typeof value === "string" && value.trim() ? [value.trim()] : [];
  });
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}
