import { describe, expect, it } from "vitest";
import {
  POOL_CONFIG_DEFAULTS,
  poolConfigSchema,
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
