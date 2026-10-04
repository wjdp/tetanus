import { describe, expect, it } from "vitest";
import { toolVersion, unsupportedTools } from "./hostTools";

describe("toolVersion", () => {
  it.each([
    ["openzfs", "zfs-2.2.2-0ubuntu9.1", "2.2.2"],
    ["openzfs", "zfs-2.3.0-1", "2.3.0"],
    ["openzfs", "zfs-kmod-2.3.0-1", null],
    [
      "smartmontools",
      "smartctl 7.4 2023-08-01 r5530 [x86_64-linux-6.8.0] (local build)",
      "7.4",
    ],
    ["smartmontools", "smartctl 6.6 2017-11-05 r4594", "6.6"],
    ["smartmontools", undefined, null],
  ] as const)("reads %s from %s", (tool, raw, expected) => {
    expect(toolVersion(tool, raw)).toBe(expected);
  });
});

describe("unsupportedTools", () => {
  it("flags OpenZFS before 2.3 and smartmontools before 7.0", () => {
    expect(
      unsupportedTools({
        zfs: "zfs-2.2.2-0ubuntu9.1",
        smartctl: "smartctl 6.6 2017-11-05 r4594",
      }),
    ).toEqual([
      {
        tool: "openzfs",
        version: "2.2.2",
        minVersion: "2.3",
        sources: ["zpool-status", "zpool-list", "zfs-list", "zfs-snapshots"],
      },
      {
        tool: "smartmontools",
        version: "6.6",
        minVersion: "7.0",
        sources: ["smartctl-scan", "smartctl-xall"],
      },
    ]);
  });

  it("passes supported and unknown versions", () => {
    expect(
      unsupportedTools({
        zfs: "zfs-2.3.0-1",
        smartctl: "smartctl 7.0 2018-12-30 r4883",
      }),
    ).toEqual([]);
    expect(unsupportedTools({})).toEqual([]);
  });
});
