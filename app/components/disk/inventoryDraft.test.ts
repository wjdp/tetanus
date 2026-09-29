import { describe, expect, it } from "vitest";
import { draftFromInventory, inventoryFromDraft } from "./inventoryDraft";

describe("inventory draft", () => {
  it("fills every field, null when unset", () => {
    expect(draftFromInventory({ supplier: "eBay" })).toEqual({
      purpose: null,
      purchaseDate: null,
      purchasePrice: null,
      supplier: "eBay",
      purchaseCondition: null,
      warrantyExpiry: null,
      pin33Taped: null,
      recordingTech: null,
    });
  });

  it("clears blanks and coerces money to a number", () => {
    expect(
      inventoryFromDraft({
        purpose: "",
        purchaseDate: "",
        purchasePrice: "129.99",
        supplier: "  ",
        purchaseCondition: "shucked",
        warrantyExpiry: "2028-01-01",
        pin33Taped: false,
        recordingTech: "cmr",
      }),
    ).toEqual({
      purpose: null,
      purchaseDate: null,
      purchasePrice: 129.99,
      supplier: null,
      purchaseCondition: "shucked",
      warrantyExpiry: "2028-01-01",
      pin33Taped: false,
      recordingTech: "cmr",
    });
  });
});
