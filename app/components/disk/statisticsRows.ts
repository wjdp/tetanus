import { NVME_DATA_UNIT_BYTES } from "#shared/smart/counters";
import type { DeviceStatistics } from "#shared/smart/deviceStatistics";
import { formatBytes, formatHours } from "~/utils/format";
import type { DiskStatisticsView } from "./types";

export interface StatisticFact {
  label: string;
  value: string;
  note?: string;
  warning?: boolean;
}

export interface StatisticPane {
  id: "workload" | "errors" | "transport" | "environment";
  title: string;
  facts: StatisticFact[];
  /** Counters at zero, summarised on one line so a non-zero one stands out. */
  clear: string[];
}

const count = (value: number) => value.toLocaleString("en-GB");

function fact(
  label: string,
  value: number | undefined,
  format: (value: number) => string = count,
  extra: Partial<StatisticFact> = {},
): StatisticFact[] {
  return value === undefined ? [] : [{ label, value: format(value), ...extra }];
}

function minutes(value: number) {
  return value < 60 ? `${value} min` : formatHours(Math.round(value / 60));
}

function errorPane(
  counters: [label: string, value: number | undefined][],
  extra: StatisticFact[] = [],
): StatisticPane {
  const present = counters.filter(
    (entry): entry is [string, number] => entry[1] !== undefined,
  );
  return {
    id: "errors",
    title: "Errors",
    facts: [
      ...present
        .filter(([, value]) => value > 0)
        .map(([label, value]) => ({
          label,
          value: count(value),
          warning: true,
        })),
      ...extra,
    ],
    clear: present.filter(([, value]) => value === 0).map(([label]) => label),
  };
}

function ataPanes(
  device: DeviceStatistics,
  sectorBytes: number,
): StatisticPane[] {
  const bytes = (sectors: number) => formatBytes(sectors * sectorBytes);
  const normalised = (field: keyof DeviceStatistics) =>
    device.normalised.includes(field as never)
      ? "normalised by the drive"
      : undefined;
  const rated =
    device.specifiedMinCelsius === undefined &&
    device.specifiedMaxCelsius === undefined
      ? undefined
      : `rated ${device.specifiedMinCelsius ?? "?"}–${device.specifiedMaxCelsius ?? "?"} °C`;
  return [
    {
      id: "workload",
      title: "Workload",
      facts: [
        ...fact("Read", device.sectorsRead, bytes, {
          note:
            device.readCommands === undefined
              ? undefined
              : `${count(device.readCommands)} commands`,
        }),
        ...fact("Written", device.sectorsWritten, bytes, {
          note:
            device.writeCommands === undefined
              ? undefined
              : `${count(device.writeCommands)} commands`,
        }),
        ...fact("Power-on resets", device.powerOnResets),
        ...fact("Spindle", device.spindleHours, formatHours),
        ...fact("Head flight", device.headFlightHours, formatHours),
        ...fact("Head loads", device.headLoadEvents),
        ...fact("Emergency unloads", device.highPriorityUnloads),
        ...fact(
          "Endurance used",
          device.percentageUsed,
          (value) => `${value} %`,
          {
            note: normalised("percentageUsed"),
          },
        ),
      ],
      clear: [],
    },
    errorPane(
      [
        ["Uncorrectable", device.reportedUncorrectables],
        ["Reallocated", device.reallocatedSectors],
        ["Candidates", device.reallocationCandidates],
        ["Pending", device.pendingErrors],
        ["Start failures", device.mechanicalStartFailures],
        ["Shock events", device.shockEvents],
      ],
      fact("Read recoveries", device.readRecoveryAttempts),
    ),
    {
      id: "transport",
      title: "Transport",
      facts: [
        ...fact("CRC errors", device.crcErrors, count, {
          warning: (device.crcErrors ?? 0) > 0,
          note: (device.crcErrors ?? 0) > 0 ? "often a cable" : undefined,
        }),
        ...fact("Hardware resets", device.hardwareResets),
        ...fact("ASR events", device.asrEvents),
        ...fact("Command resets", device.commandResets),
      ],
      clear: [],
    },
    {
      id: "environment",
      title: "Environment",
      facts: [
        ...(device.lowestCelsius === undefined &&
        device.highestCelsius === undefined
          ? []
          : [
              {
                label: "Lifetime range",
                value: `${device.lowestCelsius ?? "?"} to ${device.highestCelsius ?? "?"} °C`,
                note: rated,
              },
            ]),
        ...fact(
          "Long-term average",
          device.averageLongTermCelsius,
          (value) => `${value} °C`,
          {
            note: normalised("averageLongTermCelsius"),
          },
        ),
        ...fact("Over temperature", device.minutesOverTemperature, minutes, {
          warning: (device.minutesOverTemperature ?? 0) > 0,
        }),
        ...fact("Under temperature", device.minutesUnderTemperature, minutes),
      ],
      clear: [],
    },
  ];
}

function nvmePanes(
  nvme: NonNullable<DiskStatisticsView["nvme"]>,
): StatisticPane[] {
  const units = (value: number) => formatBytes(value * NVME_DATA_UNIT_BYTES);
  return [
    {
      id: "workload",
      title: "Workload",
      facts: [
        ...fact("Read", nvme.dataUnitsRead, units, {
          note:
            nvme.hostReads === undefined
              ? undefined
              : `${count(nvme.hostReads)} commands`,
        }),
        ...fact("Written", nvme.dataUnitsWritten, units, {
          note:
            nvme.hostWrites === undefined
              ? undefined
              : `${count(nvme.hostWrites)} commands`,
        }),
        ...fact("Controller busy", nvme.controllerBusyMinutes, minutes),
        ...fact("Power cycles", nvme.powerCycles),
        ...fact("Unsafe shutdowns", nvme.unsafeShutdowns, count, {
          note: "power lost without a clean shutdown",
        }),
      ],
      clear: [],
    },
    errorPane([
      ["Media errors", nvme.mediaErrors],
      ["Error log entries", nvme.errorLogEntries],
    ]),
    {
      id: "environment",
      title: "Environment",
      facts: [
        ...fact(
          "Above warning temperature",
          nvme.warningTemperatureMinutes,
          minutes,
          {
            warning: (nvme.warningTemperatureMinutes ?? 0) > 0,
          },
        ),
        ...fact(
          "Above critical temperature",
          nvme.criticalTemperatureMinutes,
          minutes,
          {
            warning: (nvme.criticalTemperatureMinutes ?? 0) > 0,
          },
        ),
      ],
      clear: [],
    },
  ];
}

export function statisticPanes(
  statistics: DiskStatisticsView,
): StatisticPane[] {
  const panes = statistics.device
    ? ataPanes(statistics.device, statistics.logicalBlockSize ?? 512)
    : statistics.nvme
      ? nvmePanes(statistics.nvme)
      : [];
  return panes.filter((pane) => pane.facts.length > 0 || pane.clear.length > 0);
}

export function flaggedCount(panes: StatisticPane[]) {
  return panes.reduce(
    (total, pane) => total + pane.facts.filter((entry) => entry.warning).length,
    0,
  );
}
