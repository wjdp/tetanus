import { describe, expect, it } from "vitest";
import nasdisks from "../server/services/drive-db/nasdisks.json";
import overrides from "../server/services/drive-db/overrides.json";
import {
  WARRANTY_YEARS_BY_LINE,
  warrantyDefault,
  warrantyYearsFor,
} from "./product-lines";

const datasetLines = new Set(
  [...nasdisks.drives, ...overrides.drives].map((drive) => drive.line),
);

describe("WARRANTY_YEARS_BY_LINE", () => {
  it.each(Object.keys(WARRANTY_YEARS_BY_LINE))(
    "%s appears in the dataset",
    (line) => {
      expect(datasetLines.has(line)).toBe(true);
    },
  );

  it("has no entry for white-label lines", () => {
    expect(datasetLines.has("White label")).toBe(true);
    expect(WARRANTY_YEARS_BY_LINE).not.toHaveProperty("White label");
    expect(WARRANTY_YEARS_BY_LINE).not.toHaveProperty(
      "White label (Ultrastar He12)",
    );
  });
});

describe("warrantyYearsFor", () => {
  it.each([
    ["Exos X18", 5],
    ["Exos X16", 5],
    ["IronWolf Pro", 5],
    ["IronWolf", 3],
    ["BarraCuda", 2],
    ["Red Plus", 3],
    ["MG09", 5],
    ["870 EVO", 5],
    ["DC S4610", 5],
  ])("%s → %d", (line, years) => {
    expect(warrantyYearsFor(line)).toBe(years);
  });

  it.each([null, undefined, "", "Nonsense", "toString", "White label"])(
    "%j → null",
    (line) => {
      expect(warrantyYearsFor(line)).toBeNull();
    },
  );
});

describe("warrantyDefault", () => {
  it("adds the line's years to the purchase date", () => {
    expect(
      warrantyDefault({
        purchaseDate: "2023-04-01",
        purchaseCondition: "new",
        line: "Exos X18",
      }),
    ).toBe("2028-04-01");
  });

  it("applies when the condition is unset", () => {
    expect(
      warrantyDefault({ purchaseDate: "2022-01-15", line: "IronWolf" }),
    ).toBe("2025-01-15");
  });

  it("clamps 29 February to the last day of February", () => {
    expect(
      warrantyDefault({ purchaseDate: "2024-02-29", line: "BarraCuda" }),
    ).toBe("2026-02-28");
  });

  it("is null when shucked", () => {
    expect(
      warrantyDefault({
        purchaseDate: "2023-04-01",
        purchaseCondition: "shucked",
        line: "Red",
      }),
    ).toBeNull();
  });

  it("is null for an unknown line, missing date or malformed date", () => {
    expect(
      warrantyDefault({ purchaseDate: "2023-04-01", line: "Mystery" }),
    ).toBeNull();
    expect(warrantyDefault({ purchaseDate: null, line: "Red" })).toBeNull();
    expect(warrantyDefault({ purchaseDate: "April", line: "Red" })).toBeNull();
    expect(
      warrantyDefault({ purchaseDate: "2023-04-01", line: null }),
    ).toBeNull();
  });
});
