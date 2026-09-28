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

  it("does not let a patch move the alert cursor", () => {
    expect(() =>
      settingsPatchSchema.parse({ config: { alertCursor: 0 } }),
    ).toThrow();
  });

  it("accepts one notification channel at a time", () => {
    expect(
      settingsPatchSchema.parse({
        config: { notifications: { webhook: { url: "https://x.test/h" } } },
      }),
    ).toEqual({
      config: { notifications: { webhook: { url: "https://x.test/h" } } },
    });
  });

  it("drops an empty webhook secret", () => {
    expect(
      settingsPatchSchema.parse({
        config: {
          notifications: { webhook: { url: "https://x.test/h", secret: "" } },
        },
      }).config.notifications?.webhook,
    ).toEqual({ url: "https://x.test/h" });
  });

  it("rejects a non-http webhook URL", () => {
    expect(() =>
      settingsPatchSchema.parse({
        config: { notifications: { webhook: { url: "file:///etc/passwd" } } },
      }),
    ).toThrow();
  });
});
