import { describe, expect, it } from "vitest";
import { hasTransform, transform } from "./transforms";

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

describe("transform 194 (temperature)", () => {
  it("keeps the lowest byte of the raw value", () => {
    expect(transform(194, 100, 163210330144, "32 (Min/Max 20/38)")).toBe(32);
    expect(transform(194, 100, 41, "41")).toBe(41);
  });
});

describe("attributes without a transform", () => {
  it("returns the raw value unchanged", () => {
    expect(hasTransform(5)).toBe(false);
    expect(transform(5, 100, 56, "56")).toBe(56);
  });
});
