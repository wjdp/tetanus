import { describe, expect, it } from "vitest";
import { readFixture } from "../../test/fixtures";
import { extractDeviceStatistics } from "./deviceStatistics";
import { parse } from "./smartctl-xall";

const statisticsOf = (fixture: string) =>
  parse(readFixture(`mars/smartctl/${fixture}`), {}).data.deviceStatistics;

describe("extractDeviceStatistics", () => {
  it("decodes a WD drive's pages into named fields", () => {
    const json = JSON.parse(readFixture("mars/smartctl/xall-sda-auto.json"));
    const statistics = statisticsOf("xall-sda-auto.json");
    expect(statistics?.powerOnHours).toBe(json.power_on_time.hours);
    expect(statistics).toMatchObject({
      powerOnResets: expect.any(Number),
      sectorsWritten: expect.any(Number),
      readCommands: expect.any(Number),
      spindleHours: expect.any(Number),
      reallocatedSectors: expect.any(Number),
      reportedUncorrectables: expect.any(Number),
      highestCelsius: expect.any(Number),
      specifiedMaxCelsius: expect.any(Number),
      hardwareResets: expect.any(Number),
      crcErrors: expect.any(Number),
    });
    expect(statistics?.normalised).toContain("averageLongTermCelsius");
  });

  it("leaves out rolling values and flags", () => {
    const statistics = statisticsOf("xall-sdg-auto.json");
    expect(Object.keys(statistics ?? {})).not.toEqual(
      expect.arrayContaining(["currentCelsius", "timestamp"]),
    );
    expect(statistics?.shockEvents).toBeTypeOf("number");
    expect(statistics?.pendingErrors).toBeTypeOf("number");
  });

  it("keeps only valid entries", () => {
    expect(
      extractDeviceStatistics({
        pages: [
          {
            number: 1,
            table: [
              { offset: 8, value: 5, flags: { valid: true } },
              { offset: 16, value: 9, flags: { valid: false } },
            ],
          },
        ],
      }),
    ).toEqual({ powerOnResets: 5, normalised: [] });
  });

  it("reads SSD percentage used", () => {
    expect(statisticsOf("xall-sdr-auto.json")?.percentageUsed).toBeTypeOf(
      "number",
    );
  });

  it("is absent without the log", () => {
    expect(statisticsOf("xall-sdq-auto.json")).toBeUndefined();
    expect(statisticsOf("xall-nvme0.json")).toBeUndefined();
    expect(extractDeviceStatistics({ pages: [] })).toBeUndefined();
  });
});
