import { describe, expect, it } from "vitest";
import { transform } from "./transforms";

describe("transform 188 (Seagate command timeout)", () => {
  it("takes the last piece of a non-decreasing three-piece raw string", () => {
    expect(transform(188, 100, 4295032835, "1 1 3")).toBe(3);
    expect(transform("188", 100, 2, "0 0 2")).toBe(2);
  });

  it("falls back to the raw value when the pieces decrease", () => {
    expect(transform(188, 100, 8590065667, "2 1 3")).toBe(8590065667);
    expect(transform(188, 100, 4295032832, "1 1 0")).toBe(4295032832);
  });

  it("falls back to the raw value unless there are exactly three integers", () => {
    expect(transform(188, 100, 0, "0")).toBe(0);
    expect(transform(188, 100, 7, "0 0 0 7")).toBe(7);
    expect(transform(188, 100, 9, "0 x 9")).toBe(9);
  });
});

describe("default transform (leading integer of the raw string)", () => {
  it("decodes smartctl's rendering of packed raw values", () => {
    expect(transform(1, 81, 137774677, "0/137774677")).toBe(0);
    expect(transform(3, 166, 34385691022, "398 (Average 396)")).toBe(398);
    expect(transform(240, 100, 6405497045407342, "22126h+24m+51.396s")).toBe(
      22126,
    );
    expect(transform(194, 154, 227634315306, "42 (Min/Max 16/53)")).toBe(42);
    expect(transform(194, 41, 81604378665, "41 (0 19 0 0 0)")).toBe(41);
    expect(transform(9, 100, 2607, "2607 (42 65535)")).toBe(2607);
  });

  it("returns a plain integer unchanged", () => {
    expect(transform(4, 100, 63, "63")).toBe(63);
  });

  it("falls back to the raw value without a leading integer", () => {
    expect(transform(5, 100, 56, "")).toBe(56);
    expect(transform(5, 100, 56, "n/a")).toBe(56);
  });

  it("falls back to the raw value when the leading integer is unsafe", () => {
    expect(transform(241, 100, 12, "99999999999999999999")).toBe(12);
  });
});
