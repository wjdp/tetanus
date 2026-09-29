import { describe, expect, it } from "vitest";
import {
  draftFromInventory,
  inventoryFromDraft,
  warrantySuggestion,
} from "./inventoryDraft";

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

describe("warranty suggestion", () => {
  const purchased = draftFromInventory({ purchaseDate: "2023-04-01" });

  it("suggests the line default from the purchase date", () => {
    expect(warrantySuggestion(purchased, "Exos X18")).toEqual({
      date: "2028-04-01",
      text: "5 y from purchase → 2028-04-01 (Exos X18 default)",
    });
  });

  it("stays quiet when the expiry is set, the disk was shucked or the line is unknown", () => {
    const set = draftFromInventory({
      purchaseDate: "2023-04-01",
      warrantyExpiry: "2027-01-01",
    });
    const shucked = draftFromInventory({
      purchaseDate: "2023-04-01",
      purchaseCondition: "shucked",
    });
    expect(warrantySuggestion(set, "Exos X18")).toBeNull();
    expect(warrantySuggestion(shucked, "Exos X18")).toBeNull();
    expect(warrantySuggestion(purchased, "Mystery Line")).toBeNull();
    expect(warrantySuggestion(purchased, null)).toBeNull();
    expect(warrantySuggestion(draftFromInventory({}), "Exos X18")).toBeNull();
  });
});
