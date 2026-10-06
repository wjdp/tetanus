import { describe, expect, it } from "vitest";
import { capacityFact, formatNominalCapacity } from "./capacityFact";

const spec = (capacityTb: number | null) => ({ capacityTb });

describe("capacityFact", () => {
  it("notes the nominal size when more than 2 % below it", () => {
    expect(capacityFact(15e12, spec(16))).toBe("15.0 TB (nominal 16 TB)");
  });

  it("shows the plain capacity within 2 % of nominal", () => {
    expect(capacityFact(16_000_900_169_728, spec(16))).toBe("16.0 TB");
    expect(capacityFact(15.7e12, spec(16))).toBe("15.7 TB");
  });

  it("shows the plain capacity when larger than nominal", () => {
    expect(capacityFact(18e12, spec(16))).toBe("18.0 TB");
  });

  it("shows the plain capacity without a spec, nominal size or capacity", () => {
    expect(capacityFact(15e12, null)).toBe("15.0 TB");
    expect(capacityFact(15e12, spec(null))).toBe("15.0 TB");
    expect(capacityFact(null, spec(16))).toBe("—");
  });
});

describe("formatNominalCapacity", () => {
  it("drops needless decimals without rounding real ones", () => {
    expect(formatNominalCapacity(16)).toBe("16 TB");
    expect(formatNominalCapacity(1.92)).toBe("1.92 TB");
    expect(formatNominalCapacity(0.48)).toBe("480 GB");
  });
});
