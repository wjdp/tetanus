import { farmHoursComparable, smartResetHours } from "#shared/smart/farm";
import type {
  SeagateFarm,
  SeagateFarmHead,
  VoltageRange,
} from "#shared/smartctl";
import { formatBytes } from "~/utils/format";

export const HEAD_RESISTANCE_TOLERANCE = 0.2;

export interface FarmFact {
  label: string;
  value: string | null;
  note?: string;
  warning?: boolean;
}

export type FarmHoursVerdict =
  | "agrees"
  | "reset"
  | "not-comparable"
  | "unknown";

const count = (value: number | undefined) =>
  value === undefined ? null : value.toLocaleString("en-GB");

const hours = (value: number | undefined | null) =>
  value === undefined || value === null
    ? null
    : `${value.toLocaleString("en-GB")} h`;

const celsius = (value: number | undefined) =>
  value === undefined ? null : `${value} °C`;

function volts(range: VoltageRange | undefined) {
  if (!range) return null;
  const format = (millivolts: number | undefined) =>
    millivolts === undefined ? "?" : (millivolts / 1000).toFixed(2);
  const span =
    range.minimum === undefined && range.maximum === undefined
      ? null
      : `${format(range.minimum)}–${format(range.maximum)} V`;
  const current =
    range.current === undefined ? null : `${format(range.current)} V now`;
  return [span, current].filter(Boolean).join(", ") || null;
}

function share(part: number | undefined, whole: number | undefined) {
  if (part === undefined || !whole) return undefined;
  return `${Math.round((part / whole) * 100)} % random`;
}

export function farmHoursVerdict(
  farm: SeagateFarm,
  smartHours: number | null,
): FarmHoursVerdict {
  if (farm.powerOnHours === undefined || smartHours === null) return "unknown";
  if (!farmHoursComparable(farm)) return "not-comparable";
  return smartResetHours(farm, smartHours) === null ? "agrees" : "reset";
}

const VERDICT_NOTES: Record<FarmHoursVerdict, (smart: string) => string> = {
  agrees: (smart) => `SMART ${smart}`,
  reset: (smart) => `SMART shows ${smart}: counters reset`,
  "not-comparable": (smart) =>
    `SMART ${smart}; FARM 3.x hours are not compared`,
  unknown: () => "",
};

export function driveFacts(
  farm: SeagateFarm,
  smartHours: number | null,
): FarmFact[] {
  const verdict = farmHoursVerdict(farm, smartHours);
  return [
    {
      label: "Powered on",
      value: hours(farm.powerOnHours),
      note: VERDICT_NOTES[verdict](hours(smartHours) ?? "?") || undefined,
      warning: verdict === "reset",
    },
    { label: "Spindle", value: hours(farm.spindleHours) },
    { label: "Head flight", value: hours(farm.headFlightHours) },
    { label: "Power cycles", value: count(farm.powerCycles) },
    { label: "Head loads", value: count(farm.headLoadEvents) },
    { label: "Resets", value: count(farm.resetCount) },
    { label: "Recording", value: farm.recordingType ?? null },
    { label: "Assembled", value: farm.assembledWeek ?? null },
    {
      label: "Helium",
      value:
        farm.heliumPressureTripped === undefined
          ? null
          : farm.heliumPressureTripped
            ? "pressure tripped"
            : "ok",
      warning: farm.heliumPressureTripped === true,
    },
    { label: "Log version", value: farm.logVersion ?? null },
  ];
}

export function workloadFacts(farm: SeagateFarm): FarmFact[] {
  const { workload } = farm;
  const sectorBytes = farm.logicalSectorSize ?? 512;
  const bytes = (sectors: number | undefined) =>
    sectors === undefined ? null : formatBytes(sectors * sectorBytes);
  return [
    {
      label: "Read commands",
      value: count(workload.readCommands),
      note: share(workload.randomReads, workload.readCommands),
    },
    {
      label: "Write commands",
      value: count(workload.writeCommands),
      note: share(workload.randomWrites, workload.writeCommands),
    },
    { label: "Read", value: bytes(workload.sectorsRead) },
    { label: "Written", value: bytes(workload.sectorsWritten) },
  ];
}

export function errorFacts(farm: SeagateFarm): FarmFact[] {
  const { errors } = farm;
  const counted = (label: string, value: number | undefined) => ({
    label,
    value: count(value),
    warning: (value ?? 0) > 0,
  });
  return [
    counted("Unrecoverable reads", errors.unrecoverableReads),
    counted("Unrecoverable writes", errors.unrecoverableWrites),
    counted("Reallocated", errors.reallocatedSectors),
    counted("Candidates", errors.reallocationCandidates),
    counted("Start failures", errors.mechanicalStartFailures),
    { label: "ASR events", value: count(errors.asrEvents) },
    { label: "CRC errors", value: count(errors.crcErrors) },
    { label: "Timeouts", value: count(errors.commandTimeouts) },
  ];
}

export function environmentFacts(farm: SeagateFarm): FarmFact[] {
  const { environment } = farm;
  const specified =
    environment.specifiedMinCelsius === undefined &&
    environment.specifiedMaxCelsius === undefined
      ? undefined
      : `rated ${environment.specifiedMinCelsius ?? "?"}–${environment.specifiedMaxCelsius ?? "?"} °C`;
  return [
    {
      label: "Lifetime range",
      value:
        environment.lowestCelsius === undefined &&
        environment.highestCelsius === undefined
          ? null
          : `${celsius(environment.lowestCelsius) ?? "?"} to ${celsius(environment.highestCelsius) ?? "?"}`,
      note: specified,
    },
    { label: "Average", value: celsius(environment.averageCelsius) },
    { label: "12 V", value: volts(environment.millivolts12) },
    { label: "5 V", value: volts(environment.millivolts5) },
  ];
}

export function presentFacts(facts: FarmFact[]) {
  return facts.filter((fact) => fact.value !== null);
}

export interface HeadRow extends SeagateFarmHead {
  head: number;
  resistanceOutlier: boolean;
}

function median(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]
    : ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2;
}

export function headRows(farm: SeagateFarm): HeadRow[] {
  const resistances = farm.perHead
    .map((head) => head.mrResistance)
    .filter((value) => value !== undefined && value > 0) as number[];
  const typical = resistances.length ? median(resistances) : undefined;
  return farm.perHead.map((values, head) => ({
    ...values,
    head,
    resistanceOutlier:
      typical !== undefined &&
      values.mrResistance !== undefined &&
      Math.abs(values.mrResistance - typical) >
        typical * HEAD_RESISTANCE_TOLERANCE,
  }));
}
