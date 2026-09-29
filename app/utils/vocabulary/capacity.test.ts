import { describe, expect, it } from "vitest";
import { capacityColour } from "./capacity";

describe("capacityColour", () => {
  it.each([
    [null, "neutral"],
    [0, "neutral"],
    [79, "neutral"],
    [80, "warning"],
    [89, "warning"],
    [90, "error"],
    [100, "error"],
  ] as const)("colours %s %% as %s", (capacity, colour) => {
    expect(capacityColour(capacity)).toBe(colour);
  });
});
