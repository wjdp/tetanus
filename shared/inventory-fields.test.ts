import { describe, expect, it } from "vitest";
import { INVENTORY_FIELDS, inventorySchema } from "./inventory-fields";

describe("inventorySchema", () => {
  it("has a rule for every registry field", () => {
    expect(Object.keys(inventorySchema.shape).sort()).toEqual(
      INVENTORY_FIELDS.map((field) => field.key).sort(),
    );
  });

  it("accepts a full inventory", () => {
    const inventory = {
      purchaseDate: "2023-04-01",
      purchasePrice: 189.99,
      supplier: "Scan",
      purchaseCondition: "shucked",
      warrantyExpiry: "2026-04-01",
      pin33Taped: true,
    };
    expect(inventorySchema.parse(inventory)).toEqual(inventory);
  });

  it("accepts an empty inventory and explicit nulls", () => {
    expect(inventorySchema.parse({})).toEqual({});
    expect(inventorySchema.parse({ supplier: null })).toEqual({
      supplier: null,
    });
  });

  it("trims text", () => {
    expect(inventorySchema.parse({ supplier: "  Scan " })).toEqual({
      supplier: "Scan",
    });
  });

  it.each([
    { purchaseDate: "01/04/2023" },
    { purchaseDate: "2023-02-30" },
    { warrantyExpiry: "2026-04-01T00:00:00Z" },
    { purchasePrice: -1 },
    { purchasePrice: "189.99" },
    { purchaseCondition: "second-hand" },
    { pin33Taped: "yes" },
    { colour: "blue" },
  ])("rejects %o", (inventory) => {
    expect(inventorySchema.safeParse(inventory).success).toBe(false);
  });
});
