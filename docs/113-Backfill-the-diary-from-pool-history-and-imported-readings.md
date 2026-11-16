---
type: task
status: todo
---

# Backfill the diary from pool history and imported readings

The diary starts on the day tetanus was installed. Each pool's own history goes back to
its creation, and imported Scrutiny readings go back years, but none of it reaches the
diary.

## Problem

Pool, dataset and vdev diary entries come only from comparing successive collector runs.
For example, a scrub result appears in `zpool status` and a dataset appears in `zfs list`
(`server/services/zfs/topology.ts`, `server/services/zfs/datasets.ts`). Anything that
happened before a host's first run is missing:

- when each pool was created, imported, upgraded or had properties changed;
- datasets created, destroyed or renamed;
- scrubs and resilvers, with their error counts;
- disk swaps: `zpool replace`, `attach`, `detach`, `offline` and `online`. These would
  give real dates for each disk joining and leaving a pool, which is the core of a disk's
  diary ([001](001-Product-goals.md)).

The data exists:

- **`zpool history -il`** goes back to pool creation, unless the pool's history log has
  wrapped: it is a ring buffer of 0.1 % of the pool, capped at 1 GiB, and ZFS keeps the
  creation record. The collector sends only `tail -n 500` per pool
  (`history_per_pool zpool-history tail -n 500` in `host/tetanus-collect`), which on a
  pool running sanoid is a few minutes of snapshot churn.
- **`Dataset.creation`** is stored for every dataset. On the prod host, most datasets
  predate tetanus, some by years.
- **Imported Scrutiny readings** (`SmartReading` with an import source) go back years
  for most disks. Only an `imported-from-scrutiny` entry marks them in the diary.

## Context

- **Live entries.** Diary writes go through `addAutoEvent` (`server/services/diary.ts`).
  The event types are listed in `shared/diary.ts` (`DIARY_EVENT_TYPES`).
  `dataset-created`, `dataset-destroyed`, `scrub-finished`, `resilver-finished`,
  `vdev-joined` and `vdev-left` already exist. Pool creation, import, rename and
  vdev replace do not.
- **Alerts read the diary.** `dispatch.ts` sends rules for every entry with an id above
  `Setting.config.alertCursor` (`server/services/alerts/rules.ts`). For example, a
  `scrub-finished` with errors > 0 raises `pool-data-errors`. Backfilled entries get new
  ids, so without care a backfill sends a burst of years-old alerts.
- **Other readers of the diary:** scrub-overdue and pool faults take the latest
  `scrub-finished` per pool (`latestPoolEntries` in `server/services/poolFaults.ts`).
  Backfilled scrubs older than the live ones don't change "latest", but a pool whose
  only scrubs predate tetanus would gain a baseline.
- **Pool history ingest.** `observeZpoolHistory` and `isRoutineHistory`
  (`server/services/zfs/history.ts`). Routine lines older than the retention cutoff are
  dropped on arrival (`retainedHistoryEntries`), so a full history send stores only the
  structural lines. Those are kept forever ([063](063-Retention-and-downsampling.md),
  [109](109-Pool-history-list-shows-only-routine-churn.md)).
- **Line formats** (UTC, from `zpool history -il` under `TZ=UTC`):
  - commands: `zpool create …`, `zpool import …`, `zpool replace tank <old> <new>`,
    `zfs create tank/a`, `zfs rename tank/a tank/b`, `zfs destroy -r tank/a`;
  - internal: `create tank/a (id)`, `scan setup func=1 mintxg=… maxtxg=…`
    (func 1 = scrub, 2 = resilver), `scan done errors=N`, `vdev attach …`,
    `set tank (id) compression=…`.
  `server/demo/zpoolHistory.ts` generates some of these for the demo. Real fixtures
  for the structural lines don't exist yet; capture them scrubbed (`bin/scrub-fixtures.py`).
- **Device names.** Replace and attach lines name devices by the path given to the
  command, usually `/dev/disk/by-id/…`. `DiskKey` holds `by-id` keys, including those
  for retired disks imported from Scrutiny, so most can be resolved to a `Disk`.
  Short names (`sdb`) can't be resolved after the fact.
- **Existing backfills to copy:** `replications:backfill`
  (`server/services/replications/backfill.ts`) and `faults:backfill`
  (`server/services/faultsBackfill.ts`). Both are queued once at boot from
  `server/plugins/migrate.ts`, with a `*BackfilledAt` marker in `Setting.config`. The
  fault backfill already replays every `SmartReading`.
- **Collector.** Meant to stay dumb ([003](003-Architecture-and-data-model.md)). A
  collector change needs a `version` bump and raises `collector-outdated` until each host
  is updated. `--only <source>` already exists for one-off runs.

## Decisions to make

- **Scope.** All three sources in one task, or ship `Dataset.creation` first (no
  collector change), then pool history, then the SMART replay?
- **Getting full history.** A one-off source (`--only zpool-history-full`) run by hand,
  or a one-time send triggered by the server (e.g. when a host has never sent full
  history)? Filter routine lines on the host (`grep -v`, which bends "dumb collector"
  slightly but cuts a possibly 1 GiB log to a few thousand lines) or on the server?
- **Avoiding duplicates with live entries.** Backfill only entries dated before the
  host's `firstSeenAt`, or match each one against existing entries by (subject, type,
  time within a tolerance)?
- **Alerts.** Make the alert dispatcher skip backfilled entries (e.g. `data.backfilled`),
  or move `alertCursor` past them when the backfill finishes? The first survives a
  backfill that runs while new live entries arrive.
- **New event types.** Which to add: `pool-created`, `pool-imported`, `pool-exported`,
  `pool-upgraded`, `dataset-renamed`, `vdev-replaced`, `property-set`? Property
  changes could be noisy; perhaps only selected properties (compression, encryption,
  quota, recordsize).
- **Subjects that no longer exist.** Destroyed datasets and devices with no `Disk` row:
  attach the entry to the pool and name the dataset or device in the text? Or create
  placeholder subjects?
- **Disk diaries.** A replace line gives a date for both the outgoing and the incoming
  disk. Write an entry on both disks as well as the pool? Should it also set or suggest
  `replacesDiskId` ([040](040-Disk-disposal.md))?
- **SMART replay.** Derive `smart-status-changed` and `attribute-status-changed` from
  imported readings using the current SMART policy? These would be judged by today's
  rules, not what Scrutiny said at the time. Is that acceptable if the entries are
  labelled?
- **Presentation.** Should backfilled entries show a "from history" marker in the
  timeline, and should they be excluded from anything that counts recent activity?
- **Wrapped logs.** If a pool's history has wrapped, the oldest lines are gone apart
  from the creation record. Is it worth saying so in the diary, e.g. an entry noting
  that history before a date isn't available?
