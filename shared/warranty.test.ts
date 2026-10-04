import { describe, expect, it } from "vitest";
import { effectiveWarranty, warrantySuggestion } from "./warranty";

describe("effectiveWarranty", () => {
  it("takes whichever expiry ends later and says whose it is", () => {
    expect(
      effectiveWarranty({
        warrantyExpiry: "2027-01-01",
        sellerWarrantyExpiry: "2026-01-01",
      }),
    ).toEqual({ expiry: "2027-01-01", source: "manufacturer" });
    expect(
      effectiveWarranty({
        warrantyExpiry: "2025-01-01",
        sellerWarrantyExpiry: "2026-01-01",
      }),
    ).toEqual({ expiry: "2026-01-01", source: "seller" });
    expect(effectiveWarranty({ sellerWarrantyExpiry: "2026-01-01" })).toEqual({
      expiry: "2026-01-01",
      source: "seller",
    });
  });

  it("is null with neither", () => {
    expect(effectiveWarranty({})).toBeNull();
  });
});

describe("warranty suggestion", () => {
  const purchased = { purchaseDate: "2023-04-01" };

  it("suggests the line default from the purchase date", () => {
    expect(warrantySuggestion(purchased, "Exos X18")).toEqual({
      date: "2028-04-01",
      text: "5 y from purchase → 2028-04-01 (Exos X18 default)",
    });
  });

  it("stays quiet when the expiry is set, the disk was shucked or the line is unknown", () => {
    expect(
      warrantySuggestion(
        { ...purchased, warrantyExpiry: "2027-01-01" },
        "Exos X18",
      ),
    ).toBeNull();
    expect(
      warrantySuggestion(
        { ...purchased, purchaseCondition: "shucked" },
        "Exos X18",
      ),
    ).toBeNull();
    expect(warrantySuggestion(purchased, "Mystery Line")).toBeNull();
    expect(warrantySuggestion(purchased, null)).toBeNull();
    expect(warrantySuggestion({}, "Exos X18")).toBeNull();
  });
});
