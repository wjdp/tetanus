import { sqlite } from "~~/server/database/client";
import { optimiseDatabase } from "~~/server/services/database";
import { FULL_TEMPERATURE_DAYS } from "~~/server/services/smart";
import {
  isRoutineHistory,
  routineHistoryCutoff,
} from "~~/server/services/zfs/history";

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

export const HISTORY_EVENT_DAYS = 2;
export const COLLECTOR_RUN_DAYS = 30;
export const FULL_DATASET_READING_DAYS = 90;
export const FULL_POOL_READING_DAYS = 30;
export const FULL_SMART_DAYS = 30;
export const HOURLY_TEMPERATURE_DAYS = 365;

const BATCH_SIZE = 2000;
const AUTO_VACUUM_INCREMENTAL = 2;

export type PruneCounts = Record<string, number>;

const daysBefore = (now: Date, days: number) => now.getTime() - days * DAY_MS;

/** Gives ingest a turn between batches; better-sqlite3 blocks while it runs. */
const yieldToEventLoop = () => new Promise((resolve) => setImmediate(resolve));

async function deleteInBatches(
  selectIds: string,
  table: string,
  params: Record<string, number>,
): Promise<number> {
  const statement = sqlite.prepare(
    `DELETE FROM ${table} WHERE id IN (${selectIds} LIMIT ${BATCH_SIZE})`,
  );
  let total = 0;
  for (;;) {
    const { changes } = statement.run(params);
    total += changes;
    if (changes < BATCH_SIZE) return total;
    await yieldToEventLoop();
  }
}

// Bucket sizes are inlined: bound JS numbers arrive as REAL and would turn the
// bucket arithmetic into float division.

/**
 * Keeps the newest row of each (key, bucket) older than the cutoff: a row goes
 * when a later row of the same key falls in the same bucket.
 */
function collapse(
  table: string,
  key: string,
  cutoff: number,
  bucketMs: number,
) {
  return deleteInBatches(
    `SELECT r.id FROM ${table} r
      WHERE r.at < :cutoff
        AND EXISTS (
          SELECT 1 FROM ${table} n
           WHERE n.${key} = r.${key}
             AND n.at >= r.at
             AND n.at < (r.at / ${bucketMs} + 1) * ${bucketMs}
             AND (n.at > r.at OR n.id > r.id)
        )`,
    table,
    { cutoff },
  );
}

/**
 * History events are the ZED copy of `zpool history -i`, which PoolHistory
 * already holds. Keep those still in the kernel buffer (the next dump re-sends
 * them) and the one just below it, which anchors missed-event detection.
 */
function pruneHistoryEvents(now: Date) {
  return deleteInBatches(
    `SELECT e.id FROM ZfsEvent e JOIN Host h ON h.id = e.hostId
      WHERE e.class = 'sysevent.fs.zfs.history_event'
        AND e.at < :cutoff
        AND (e.eid IS NULL OR e.eid < h.zpoolEventsOldestEid - 1)`,
    "ZfsEvent",
    { cutoff: daysBefore(now, HISTORY_EVENT_DAYS) },
  );
}

/** Every reader wants a source's latest run, so that survives any age. */
function pruneCollectorRuns(now: Date) {
  return deleteInBatches(
    `SELECT id FROM CollectorRun
      WHERE receivedAt < :cutoff
        AND id NOT IN (
          SELECT max(id) FROM CollectorRun GROUP BY hostId, source, device
        )`,
    "CollectorRun",
    { cutoff: daysBefore(now, COLLECTOR_RUN_DAYS) },
  );
}

async function pruneRoutineHistory(now: Date) {
  const page = sqlite.prepare(
    `SELECT id, internal, text FROM PoolHistory
      WHERE at < :cutoff AND id > :after
      ORDER BY id LIMIT ${BATCH_SIZE}`,
  );
  const remove = sqlite.prepare("DELETE FROM PoolHistory WHERE id = ?");
  const removeAll = sqlite.transaction((ids: number[]) => {
    for (const id of ids) remove.run(id);
  });
  const cutoff = routineHistoryCutoff(now).getTime();
  let after = 0;
  let total = 0;
  for (;;) {
    const rows = page.all({ cutoff, after }) as {
      id: number;
      internal: number;
      text: string;
    }[];
    const routine = rows
      .filter((row) => isRoutineHistory({ ...row, internal: !!row.internal }))
      .map((row) => row.id);
    removeAll(routine);
    total += routine.length;
    if (rows.length < BATCH_SIZE) return total;
    after = rows.at(-1)?.id ?? after;
    await yieldToEventLoop();
  }
}

/** Hourly maximum from 30 days; past a year, each day's minimum and maximum. */
async function collapseTemperatures(now: Date) {
  const hourly = await deleteInBatches(
    `SELECT r.id FROM TemperatureReading r
      WHERE r.at < :cutoff
        AND EXISTS (
          SELECT 1 FROM TemperatureReading n
           WHERE n.diskId = r.diskId
             AND n.at >= r.at / ${HOUR_MS} * ${HOUR_MS}
             AND n.at < (r.at / ${HOUR_MS} + 1) * ${HOUR_MS}
             AND (n.celsius > r.celsius
               OR (n.celsius = r.celsius AND (n.at > r.at OR (n.at = r.at AND n.id > r.id))))
        )`,
    "TemperatureReading",
    { cutoff: daysBefore(now, FULL_TEMPERATURE_DAYS) },
  );
  const daily = await deleteInBatches(
    `SELECT r.id FROM TemperatureReading r
      WHERE r.at < :cutoff
        AND EXISTS (
          SELECT 1 FROM TemperatureReading n
           WHERE n.diskId = r.diskId
             AND n.at >= r.at / ${DAY_MS} * ${DAY_MS}
             AND n.at < (r.at / ${DAY_MS} + 1) * ${DAY_MS}
             AND (n.celsius > r.celsius
               OR (n.celsius = r.celsius AND (n.at > r.at OR (n.at = r.at AND n.id > r.id))))
        )
        AND EXISTS (
          SELECT 1 FROM TemperatureReading n
           WHERE n.diskId = r.diskId
             AND n.at >= r.at / ${DAY_MS} * ${DAY_MS}
             AND n.at < (r.at / ${DAY_MS} + 1) * ${DAY_MS}
             AND (n.celsius < r.celsius
               OR (n.celsius = r.celsius AND (n.at < r.at OR (n.at = r.at AND n.id < r.id))))
        )`,
    "TemperatureReading",
    { cutoff: daysBefore(now, HOURLY_TEMPERATURE_DAYS) },
  );
  return hourly + daily;
}

/** Collapsing a reading cascades to its attributes, so a kept reading keeps its full set. */
function collapseSmartReadings(now: Date) {
  return deleteInBatches(
    `SELECT r.id FROM SmartReading r
      WHERE r.takenAt < :cutoff
        AND EXISTS (
          SELECT 1 FROM SmartReading n
           WHERE n.diskId = r.diskId
             AND n.takenAt >= r.takenAt
             AND n.takenAt < (r.takenAt / ${DAY_MS} + 1) * ${DAY_MS}
             AND (n.takenAt > r.takenAt OR n.id > r.id)
        )`,
    "SmartReading",
    { cutoff: daysBefore(now, FULL_SMART_DAYS) },
  );
}

/**
 * Switching to incremental auto-vacuum needs one full VACUUM; after that each
 * run hands freed pages back to the filesystem cheaply.
 */
export function reclaimSpace(): "vacuumed" | "incremental" {
  if (
    sqlite.pragma("auto_vacuum", { simple: true }) !== AUTO_VACUUM_INCREMENTAL
  ) {
    sqlite.pragma("auto_vacuum = INCREMENTAL");
    optimiseDatabase();
    return "vacuumed";
  }
  sqlite.pragma("incremental_vacuum");
  return "incremental";
}

export async function pruneDatabase(now = new Date()): Promise<PruneCounts> {
  const counts: PruneCounts = {};
  counts.historyEvents = await pruneHistoryEvents(now);
  counts.collectorRuns = await pruneCollectorRuns(now);
  counts.poolHistory = await pruneRoutineHistory(now);
  counts.datasetReadings = await collapse(
    "DatasetReading",
    "datasetId",
    daysBefore(now, FULL_DATASET_READING_DAYS),
    DAY_MS,
  );
  counts.poolReadings = await collapse(
    "PoolReading",
    "poolId",
    daysBefore(now, FULL_POOL_READING_DAYS),
    DAY_MS,
  );
  counts.smartReadings = await collapseSmartReadings(now);
  counts.temperatureReadings = await collapseTemperatures(now);
  return counts;
}
