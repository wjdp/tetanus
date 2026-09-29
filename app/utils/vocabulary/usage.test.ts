import { describe, expect, it } from "vitest";
import { PURPOSES, USAGE_KINDS } from "#shared/usage";
import { PURPOSE_BADGE, usageColour } from "./usage";

describe("usageColour", () => {
  it.each(USAGE_KINDS)("colours %s", (kind) => {
    expect(usageColour(kind)).toBe(kind === "zfs" ? "info" : "neutral");
  });

  it("leaves unknown usage neutral", () => {
    expect(usageColour("unknown")).toBe("neutral");
  });
});

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
