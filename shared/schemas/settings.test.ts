import { describe, expect, it } from "vitest";
import { settingsPatchSchema } from "./settings";

describe("settingsPatchSchema", () => {
  it("accepts a partial config", () => {
    expect(
      settingsPatchSchema.parse({ config: { missingAfterDays: 3 } }),
    ).toEqual({ config: { missingAfterDays: 3 } });
  });

  it("rejects unknown config keys", () => {
    expect(() =>
      settingsPatchSchema.parse({ config: { bogus: true } }),
    ).toThrow();
  });

  it("rejects an attempt to set the enrol token", () => {
    expect(() =>
      settingsPatchSchema.parse({ config: {}, enrolToken: "x" }),
    ).toThrow();
  });

  it("rejects a non-positive missing threshold", () => {
    expect(() =>
      settingsPatchSchema.parse({ config: { missingAfterDays: 0 } }),
    ).toThrow();
  });
});
