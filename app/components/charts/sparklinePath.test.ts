import { describe, expect, it } from "vitest";
import { sparklinePoints } from "./sparklinePath";

describe("sparklinePoints", () => {
  it("is empty without values", () => {
    expect(sparklinePoints([])).toBe("");
  });

  it("spans the width and inverts y so higher values sit higher", () => {
    expect(sparklinePoints([0, 5, 10], 80, 20)).toBe("0,19 40,10 80,1");
  });

  it("draws a flat midline for constant values", () => {
    expect(sparklinePoints([7, 7, 7], 80, 20)).toBe("0,10 40,10 80,10");
  });

  it("stretches a single value across the width", () => {
    expect(sparklinePoints([3], 80, 20)).toBe("0,10 80,10");
  });
});
