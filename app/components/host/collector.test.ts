import { describe, expect, it } from "vitest";
import { COLLECTOR_VERSION } from "#shared/collector";
import {
  collectorBadge,
  needsUpgrade,
  shortToolVersion,
  toolVersionLines,
} from "./collector";

describe("shortToolVersion", () => {
  it.each([
    ["zfs", "zfs-2.4.1-1ubuntu5.1", "2.4.1-1ubuntu5.1"],
    ["smartctl", "smartctl 7.5 2025-04-30 r5714 (local build)", "7.5"],
    ["kernel", "6.8.0-45-generic", "6.8.0-45-generic"],
  ])("shortens %s %s", (tool, version, expected) => {
    expect(shortToolVersion(tool, version)).toBe(expected);
  });
});

describe("toolVersionLines", () => {
  it("summarises zfs and smartctl only", () => {
    expect(
      toolVersionLines({
        zfs: "zfs-2.4.1",
        smartctl: "smartctl 7.5 2025-04-30",
        kernel: "6.8.0",
      }),
    ).toEqual(["zfs 2.4.1", "smartctl 7.5"]);
  });
});

describe("collectorBadge", () => {
  it("has no badge for the current collector", () => {
    expect(collectorBadge(COLLECTOR_VERSION)).toBeNull();
  });

  it("badges an unknown collector", () => {
    expect(collectorBadge(null)?.label).toBe("unknown");
  });
});

describe("needsUpgrade", () => {
  it("skips current and unknown collectors", () => {
    expect(needsUpgrade(COLLECTOR_VERSION)).toBe(false);
    expect(needsUpgrade(null)).toBe(false);
  });

  it("flags an old collector", () => {
    expect(needsUpgrade("0.1.0")).toBe(true);
  });
});
