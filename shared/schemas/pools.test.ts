import { describe, expect, it } from "vitest";
import {
  POOL_CONFIG_DEFAULTS,
  poolArchiveInputSchema,
  poolConfigSchema,
  poolsQuerySchema,
  resolvePoolConfig,
} from "./pools";

describe("resolvePoolConfig", () => {
  it("falls back to the defaults", () => {
    expect(resolvePoolConfig(null)).toEqual(POOL_CONFIG_DEFAULTS);
    expect(resolvePoolConfig({})).toEqual({
      scrubIntervalDays: 35,
      slowIoThreshold: 10,
    });
  });

  it("keeps 0, which disables the check", () => {
    expect(
      resolvePoolConfig({ scrubIntervalDays: 0, slowIoThreshold: 25 }),
    ).toEqual({ scrubIntervalDays: 0, slowIoThreshold: 25 });
  });
});

describe("poolConfigSchema", () => {
  it("rejects negative and unknown values", () => {
    expect(poolConfigSchema.safeParse({ scrubIntervalDays: -1 }).success).toBe(
      false,
    );
    expect(poolConfigSchema.safeParse({ other: 1 }).success).toBe(false);
  });
});

describe("poolsQuerySchema", () => {
  it("excludes archived pools by default and rejects unknown filters", () => {
    expect(poolsQuerySchema.parse({})).toEqual({ archived: "exclude" });
    expect(poolsQuerySchema.parse({ archived: "only" })).toEqual({
      archived: "only",
    });
    expect(poolsQuerySchema.safeParse({ archived: "maybe" }).success).toBe(
      false,
    );
  });
});

describe("poolArchiveInputSchema", () => {
  it("accepts an empty body and trims the note", () => {
    expect(poolArchiveInputSchema.parse(undefined)).toEqual({});
    expect(poolArchiveInputSchema.parse({ note: "  test pool " })).toEqual({
      note: "test pool",
    });
    expect(poolArchiveInputSchema.safeParse({ other: 1 }).success).toBe(false);
  });
});
