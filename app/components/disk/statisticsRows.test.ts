import { describe, expect, it } from "vitest";
import { flaggedCount, statisticPanes } from "./statisticsRows";
import type { DiskStatisticsView } from "./types";

const view = (overrides: Partial<DiskStatisticsView>): DiskStatisticsView => ({
  device: null,
  nvme: null,
  farm: null,
  smartPowerOnHours: null,
  logicalBlockSize: 512,
  ...overrides,
});

describe("statisticPanes", () => {
  it("builds ATA panes, putting non-zero errors first and summarising zeros", () => {
    const panes = statisticPanes(
      view({
        device: {
          sectorsWritten: 2_000_000_000,
          writeCommands: 1_000,
          reportedUncorrectables: 1,
          reallocatedSectors: 0,
          mechanicalStartFailures: 0,
          hardwareResets: 400,
          crcErrors: 3,
          minutesOverTemperature: 0,
          averageLongTermCelsius: 41,
          normalised: ["averageLongTermCelsius"],
        },
      }),
    );
    expect(panes.map((pane) => pane.id)).toEqual([
      "workload",
      "errors",
      "transport",
      "environment",
    ]);
    const [workload, errors, transport, environment] = panes;
    expect(workload?.facts[0]).toEqual({
      label: "Written",
      value: "1.02 TB",
      note: "1,000 commands",
    });
    expect(errors?.facts).toEqual([
      { label: "Uncorrectable", value: "1", warning: true },
    ]);
    expect(errors?.clear).toEqual(["Reallocated", "Start failures"]);
    expect(
      transport?.facts.find((fact) => fact.label === "CRC errors"),
    ).toMatchObject({
      warning: true,
    });
    expect(
      transport?.facts.find((fact) => fact.label === "Hardware resets")
        ?.warning,
    ).toBeUndefined();
    expect(environment?.facts).toContainEqual({
      label: "Long-term average",
      value: "41 °C",
      note: "normalised by the drive",
    });
    expect(flaggedCount(panes)).toBe(2);
  });

  it("builds NVMe panes from health-log figures", () => {
    const panes = statisticPanes(
      view({
        nvme: {
          dataUnitsWritten: 2_000_000,
          hostWrites: 50,
          mediaErrors: 0,
          errorLogEntries: 2,
          warningTemperatureMinutes: 5,
        },
      }),
    );
    expect(panes.map((pane) => pane.id)).toEqual([
      "workload",
      "errors",
      "environment",
    ]);
    expect(panes[0]?.facts[0]).toMatchObject({
      label: "Written",
      value: "1.02 TB",
    });
    expect(panes[1]?.clear).toEqual(["Media errors"]);
    expect(panes[2]?.facts[0]).toMatchObject({ value: "5 min", warning: true });
  });

  it("has no panes without statistics", () => {
    expect(statisticPanes(view({}))).toEqual([]);
  });
});
