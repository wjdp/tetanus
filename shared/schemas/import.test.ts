import { describe, expect, it } from "vitest";
import { scrutinyImportSchema } from "./import";

const valid = { url: "https://scrutiny.example", hostId: 1, dryRun: true };

describe("scrutinyImportSchema", () => {
  it("accepts an http or https url, a host and a dry-run flag", () => {
    expect(scrutinyImportSchema.parse(valid)).toEqual(valid);
    expect(
      scrutinyImportSchema.parse({ ...valid, url: "http://10.0.0.2:8080" }).url,
    ).toBe("http://10.0.0.2:8080");
  });

  it.each([
    { url: "ftp://scrutiny.example" },
    { url: "not a url" },
    { hostId: 0 },
    { hostId: 1.5 },
    { dryRun: "yes" },
    { extra: true },
  ])("rejects %o", (override) => {
    expect(() =>
      scrutinyImportSchema.parse({ ...valid, ...override }),
    ).toThrow();
  });

  it("requires dryRun", () => {
    const { dryRun: _, ...body } = valid;
    expect(() => scrutinyImportSchema.parse(body)).toThrow();
  });
});
