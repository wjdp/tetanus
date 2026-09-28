import { describe, expect, it } from "vitest";
import { hostIdSchema, hostPatchSchema } from "./hosts";

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

  it.each([
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
