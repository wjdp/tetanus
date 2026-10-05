export const RETENTION_SCHEDULE = "0 3 * * *";
export const RETENTION_SCHEDULE_DESCRIPTION = "daily at 03:00";

export const HISTORY_EVENT_DAYS = 2;
export const COLLECTOR_RUN_DAYS = 30;
export const ROUTINE_HISTORY_DAYS = 14;
export const FULL_DATASET_READING_DAYS = 90;
export const FULL_POOL_READING_DAYS = 30;
export const FULL_SMART_DAYS = 30;
export const FULL_TEMPERATURE_DAYS = 30;
export const HOURLY_TEMPERATURE_DAYS = 365;

export interface RetentionRule {
  data: string;
  kept: string;
  reason: string;
}

export const RETENTION_RULES: RetentionRule[] = [
  {
    data: "Dataset space",
    kept: `Every reading for ${FULL_DATASET_READING_DAYS} days, then the last of each day, forever.`,
    reason:
      "The dataset chart and growth figures use recent detail; older history only needs the daily trend.",
  },
  {
    data: "Pool capacity",
    kept: `Every reading for ${FULL_POOL_READING_DAYS} days, then the last of each day, forever.`,
    reason:
      "The capacity chart covers 30 days at full detail; a daily point is enough for long-term growth.",
  },
  {
    data: "SMART attributes",
    kept: `Every reading for ${FULL_SMART_DAYS} days, then each disk's last reading of the day, forever.`,
    reason:
      "Attribute charts and the 7 d and 30 d trends read full detail; a reading carries every attribute, so about 20 rows per disk per hour add up.",
  },
  {
    data: "Temperatures",
    kept: `Every reading for ${FULL_TEMPERATURE_DAYS} days, then each hour's maximum; after ${HOURLY_TEMPERATURE_DAYS} days, each day's minimum and maximum.`,
    reason:
      "Temperature faults look back 7 days. Older charts keep the peaks and the daily range rather than every sample.",
  },
  {
    data: "Vdev error counters",
    kept: "Forever.",
    reason:
      "Written only when a counter or state changes, and fault detection compares against old baselines.",
  },
  {
    data: "Replication syncs",
    kept: "Forever.",
    reason: "One row per sync: the replication history.",
  },
  {
    data: "ZFS events",
    kept: `Error reports and pool events forever; snapshot and replication history events ${HISTORY_EVENT_DAYS} days.`,
    reason:
      "History events repeat pool history and arrive by the thousand each day. They are kept while the host can still resend them, so they are not counted as missed.",
  },
  {
    data: "Pool history",
    kept: `Routine snapshot, destroy, hold and receive lines ${ROUTINE_HISTORY_DAYS} days; everything else forever.`,
    reason:
      "Routine lines are already reflected in snapshots and replication syncs. Pool creation, imports, property changes and scrubs stay as the pool's record.",
  },
  {
    data: "Collector runs",
    kept: `${COLLECTOR_RUN_DAYS} days, plus each source's latest run whatever its age.`,
    reason:
      "Diagnostics read 30 days; last-seen times only need the latest run. ZFS event runs keep only their latest.",
  },
  {
    data: "Faults, diary, notifications and inventory",
    kept: "Forever.",
    reason: "These are the record of what happened to each disk.",
  },
];
