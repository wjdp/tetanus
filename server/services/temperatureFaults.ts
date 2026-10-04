import { and, desc, eq, gte } from "drizzle-orm";
import { isDisposed, isHistoryState } from "#shared/disk";
import { type FaultSeverity, thresholdSeverity } from "#shared/faults";
import {
  resolveSustainedMinutes,
  TEMPERATURE_CLEAR_MARGIN,
  type TemperatureThresholds,
} from "#shared/temperature";
import { db } from "~~/server/database/client";
import { temperatureReading } from "~~/server/database/schema";
import type { DiskSummary } from "~~/server/services/disks";
import type { Detection } from "~~/server/services/faults";
import type { HostWithRuns } from "~~/server/services/hosts";
import { liveFaultsByKey } from "~~/server/services/liveFaults";

const MINUTE_MS = 60 * 1000;
const LOOKBACK_MS = 7 * 24 * 60 * MINUTE_MS;
// Hourly smartctl readings arrive a little late; a gap this long still counts as continuous.
const READING_GAP_MS = 90 * MINUTE_MS;

interface Reading {
  at: Date;
  celsius: number;
}

function recentReadings(diskId: number, now: Date): Reading[] {
  return db
    .select({ at: temperatureReading.at, celsius: temperatureReading.celsius })
    .from(temperatureReading)
    .where(
      and(
        eq(temperatureReading.diskId, diskId),
        gte(temperatureReading.at, new Date(now.getTime() - LOOKBACK_MS)),
      ),
    )
    .orderBy(desc(temperatureReading.at))
    .all();
}

/** Start of the unbroken run of readings at or above `warning` that ends with the newest, measured back from it. */
export function hotRun(
  newestFirst: Reading[],
  warning: number,
  windowMs: number,
): { latest: Reading; hotSince: Date } | null {
  const [latest, ...older] = newestFirst;
  if (!latest || latest.celsius < warning) return null;
  const gapLimit = Math.max(windowMs, READING_GAP_MS);
  let earliest = latest;
  for (const reading of older) {
    if (earliest.at.getTime() - reading.at.getTime() > gapLimit) break;
    if (reading.celsius < warning) break;
    earliest = reading;
  }
  return { latest, hotSince: earliest.at };
}

function thresholdOf(
  severity: FaultSeverity,
  thresholds: TemperatureThresholds,
) {
  return severity === "error" ? thresholds.error : thresholds.warning;
}

function detection(
  row: DiskSummary,
  severity: FaultSeverity,
  celsius: number,
  hotSince: unknown,
): Detection {
  return {
    kind: "temperature-high",
    key: String(row.id),
    subjectId: row.id,
    severity,
    data: {
      celsius,
      threshold: thresholdOf(severity, row.tempThresholds),
      hotSince,
    },
  };
}

// A disk's fault is judged against its own newest reading, not the clock, so
// a host that stops reporting holds its disks' faults as they were.
export function detectTemperatureHigh({
  disks,
  hosts,
  now,
}: {
  disks: DiskSummary[];
  hosts: HostWithRuns[];
  now: Date;
}): Detection[] {
  const live = liveFaultsByKey("temperature-high");
  const hostsById = new Map(hosts.map((row) => [row.id, row]));
  return disks.flatMap((row): Detection[] => {
    if (isHistoryState(row.state) || isDisposed(row)) return [];
    if (row.state === "missing" || row.latestTemp === null) return [];
    const thresholds = row.tempThresholds;
    const current = live.get(String(row.id));
    if (current) {
      const severity = thresholdSeverity(
        current.severity,
        row.latestTemp,
        thresholds,
        TEMPERATURE_CLEAR_MARGIN,
      );
      if (!severity) return [];
      return [detection(row, severity, row.latestTemp, current.data.hotSince)];
    }
    if (row.latestTemp < thresholds.warning) return [];
    const host =
      row.lastSeenHostId === null ? null : hostsById.get(row.lastSeenHostId);
    const windowMs = resolveSustainedMinutes(host ?? null) * MINUTE_MS;
    const run = hotRun(
      recentReadings(row.id, now),
      thresholds.warning,
      windowMs,
    );
    if (!run) return [];
    if (run.latest.at.getTime() - run.hotSince.getTime() < windowMs) return [];
    const severity = thresholdSeverity(
      null,
      run.latest.celsius,
      thresholds,
      TEMPERATURE_CLEAR_MARGIN,
    );
    if (!severity) return [];
    return [
      detection(row, severity, run.latest.celsius, run.hotSince.toISOString()),
    ];
  });
}
