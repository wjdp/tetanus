import { describe, expect, it } from "vitest";
import type { SeagateFarm } from "#shared/smartctl";
import type { DeviceStatistics } from "./deviceStatistics";
import { substituteDefects } from "./substituteDefects";

const NONE = new Set<string>();

function farm(logVersion: string, errors: SeagateFarm["errors"]) {
  return { logVersion, errors } as SeagateFarm;
}

describe("substituteDefects", () => {
  it("fills a missing attribute from device statistics", () => {
    const statistics: DeviceStatistics = {
      reportedUncorrectables: 3,
      normalised: [],
    };
    expect(substituteDefects(NONE, statistics, null)).toEqual([
      expect.objectContaining({
        attrId: "187",
        name: "Reported_Uncorrect",
        transformedValue: 3,
        source: "device-statistics",
        status: "failed",
      }),
    ]);
  });

  it("passes a zero count", () => {
    const [substitute] = substituteDefects(
      NONE,
      { reallocatedSectors: 0, normalised: [] },
      null,
    );
    expect(substitute).toMatchObject({ attrId: "5", status: "passed" });
  });

  it("skips attributes the reading has", () => {
    const statistics: DeviceStatistics = {
      reallocatedSectors: 8,
      normalised: [],
    };
    expect(substituteDefects(new Set(["5"]), statistics, null)).toEqual([]);
  });

  it("skips fields flagged normalised", () => {
    const statistics: DeviceStatistics = {
      reportedUncorrectables: 3,
      normalised: ["reportedUncorrectables"],
    };
    expect(substituteDefects(NONE, statistics, null)).toEqual([]);
  });

  it("uses pending errors when there are no reallocation candidates", () => {
    const [substitute] = substituteDefects(
      NONE,
      { pendingErrors: 2, normalised: [] },
      null,
    );
    expect(substitute).toMatchObject({ attrId: "197", transformedValue: 2 });
  });

  it("falls back to FARM, summing unrecoverable reads and writes", () => {
    const substitutes = substituteDefects(
      NONE,
      { reportedUncorrectables: 0, normalised: [] },
      farm("4.2", {
        reallocatedSectors: 20,
        unrecoverableReads: 1,
        unrecoverableWrites: 1,
      }),
    );
    expect(substitutes).toEqual([
      expect.objectContaining({
        attrId: "5",
        source: "farm",
        status: "failed",
      }),
      expect.objectContaining({ attrId: "187", source: "device-statistics" }),
    ]);
  });

  it("ignores FARM logs older than major version 3", () => {
    expect(
      substituteDefects(NONE, null, farm("2.1", { reallocatedSectors: 20 })),
    ).toEqual([]);
  });
});
