import { describe, expect, it } from "vitest";
import { hostIdSchema, hostOrderSchema, hostPatchSchema } from "./hosts";

describe("hostPatchSchema", () => {
  it("accepts an empty patch", () => {
    expect(hostPatchSchema.parse({})).toEqual({});
  });

  it("clears display name and healthchecks URL with empty strings", () => {
    expect(
      hostPatchSchema.parse({ displayName: "  ", healthchecksUrl: "" }),
    ).toEqual({ displayName: null, healthchecksUrl: null });
  });

  it("trims a display name", () => {
    expect(hostPatchSchema.parse({ displayName: " Mars " })).toEqual({
      displayName: "Mars",
    });
  });

  it("accepts an http(s) healthchecks URL", () => {
    const healthchecksUrl = "https://hc-ping.com/abc";
    expect(hostPatchSchema.parse({ healthchecksUrl })).toEqual({
      healthchecksUrl,
    });
  });

  it("accepts temperature thresholds and null to clear them", () => {
    const temperatureThresholds = { hdd: { warning: 50, error: 60 } };
    expect(hostPatchSchema.parse({ temperatureThresholds })).toEqual({
      temperatureThresholds,
    });
    expect(hostPatchSchema.parse({ temperatureThresholds: null })).toEqual({
      temperatureThresholds: null,
    });
  });

  it.each([
    { temperatureThresholds: { hdd: { warning: 60, error: 50 } } },
    { temperatureThresholds: { ssd: { warning: 60, error: 60 } } },
    { temperatureThresholds: { hdd: { warning: 45 } } },
    { temperatureThresholds: { hdd: { warning: 45.5, error: 55 } } },
    { temperatureThresholds: { hdd: { warning: -1, error: 55 } } },
    { temperatureThresholds: { hdd: { warning: 45, error: 121 } } },
    { temperatureThresholds: { unknown: { warning: 45, error: 55 } } },
    { healthchecksUrl: "ftp://example.com" },
    { healthchecksUrl: "not a url" },
    { name: "renamed" },
    { notes: 3 },
  ])("rejects %j", (patch) => {
    expect(hostPatchSchema.safeParse(patch).success).toBe(false);
  });
});

describe("hostIdSchema", () => {
  it("coerces a route parameter", () => {
    expect(hostIdSchema.parse("12")).toBe(12);
  });

  it.each(["0", "-1", "1.5", "mars"])("rejects %j", (id) => {
    expect(hostIdSchema.safeParse(id).success).toBe(false);
  });
});

describe("hostOrderSchema", () => {
  it("accepts unique ids", () => {
    expect(hostOrderSchema.parse({ hostIds: [2, 1] })).toEqual({
      hostIds: [2, 1],
    });
  });

  it.each([{ hostIds: [1, 1] }, { hostIds: [0] }, {}])("rejects %j", (body) => {
    expect(hostOrderSchema.safeParse(body).success).toBe(false);
  });
});
