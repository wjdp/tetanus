import { describe, expect, it } from "vitest";
import { PURPOSES } from "#shared/usage";
import { PURPOSE_BADGE } from "./usage";

describe("PURPOSE_BADGE", () => {
  it.each(PURPOSES)("renders %s as a neutral outline badge", (purpose) => {
    expect(PURPOSE_BADGE[purpose]).toMatchObject({
      color: "neutral",
      variant: "outline",
    });
  });

  it("abbreviates system to sys", () => {
    expect(PURPOSE_BADGE.system.label).toBe("sys");
  });
});
