---
type: task
status: in-progress
---

# Retention and downsampling

Stop the database growing without bound while keeping the history that is the product. Fixed, documented policy; no setting.

## Problem

One week of real data from one busy host (about 25 disks, a few pools, sanoid/syncoid every 15 min) is about 100 MB. At that cadence, a year adds:

| Table | Rows/day | Bytes/row incl. indexes | Per year | What it is |
|---|---|---|---|---|
| `ZfsEvent` | 10 k | 500 | ~1.8 GB | 99.96 % `sysevent.fs.zfs.history_event` |
| `PoolHistory` | 6 k | 270 | ~590 MB | 96 % snapshot, destroy, hold/release and receive lines |
| `CollectorRun` | 13 k | 85 | ~400 MB | 74 % one row per ZED event |
| `SmartAttribute` | 10 k | 110 | ~400 MB | hourly reading × ~20 attributes × ~25 disks |
| `TemperatureReading` | 13 k | 38 | ~180 MB | hourly readings plus SCT history samples |
| `PoolReading` | 400 | 62 | ~9 MB | one per `zpool-status` run |
| `DatasetReading` | ~100 | 64 | ~1 MB | about daily per dataset |

The current policy is accidental: `DatasetReading` and `ReplicationSync` are pruned at 400 days, everything else is kept forever. The 90 d and 30 d figures in the dataset UI are display windows (chart, growth), not retention. SQLite does not shrink on delete without a vacuum.

## Context

- **`ZfsEvent`.** `history_event` is the ZED copy of a `zpool history -i` internal record (snapshot, destroy, receive, hold, release, clone swap, set). It has no pool guid, so the pool page's event list (`recentEvents` by `poolGuid`) never shows it, and nothing else reads it. `PoolHistory` holds the same records. However, `checkContinuity` (`server/services/zfs/events.ts`) detects missed events and eid resets from the stored eid sequence (`maxStoredEidBelow`, `eidsReset`). Not storing history events at all would make every poll report a false gap.
- **`CollectorRun`.** Every reader wants the latest row per host and source (last seen, pool presence, receive sightings, diagnostics `runFor`), except diagnostics, which reads 30 days. A plain age cutoff would make a host silent for more than 30 days look never seen.
- **`Payload`.** Already one row per (host, source, device), upserted. No retention needed.
- **`PoolHistory`.** The pool page shows the newest 50 lines. Receive derivation (`observeReceives`) re-reads from 48 h before the incoming batch. Only the one-off `backfillReplications` reads all of it, and `ReplicationSync` already holds the derived result.
- **`VdevReading`.** Written only on change. Fault detection takes a baseline from the latest row at or before a window start, which can be arbitrarily old. Already sparse.
- **`SmartReading` / `SmartAttribute`.** Attributes cascade from their reading. Readers:
  - charts: 7 d / 30 d / 1 y / all, downsampled;
  - trends: the value at or before now − 7 d and now − 30 d;
  - `valueSince` and `firstNonZeroAt`: scan all history;
  - the startup fault backfill: replays every reading.
  
  No diary, fault or acceptance row references a reading id.
- **`TemperatureReading`.** Read by the same chart ranges, the temperature fault (7-day lookback, [057](057-Temperature-fault.md)) and diagnostics (30 d). SCT samples are dated wrongly across power-off ([093](093-SCT-temperature-history-dated-across-power-off.md)).
- **Scheduling.** Nitro `scheduledTasks` already run `*/5 * * * *` ticks that enqueue onto the DB task queue (`server/tasks/`).

## Plan

Retention by table. "Full" means as written today.

| Table | Full detail for | Then | Forever cost (this host) |
|---|---|---|---|
| `ZfsEvent` `history_event` | 2 days and still in the kernel buffer | delete once older than 2 days **and** below the oldest eid of the host's latest `zpool events` dump | ≤ ~512 rows per host |
| `ZfsEvent` other classes | forever | — | negligible |
| `CollectorRun` `zed-event` | latest only | upsert one row per host at ingest instead of inserting | — |
| `CollectorRun` other sources | 30 days | delete, except the newest per (host, source, device) | ~9 MB steady |
| `Payload` | latest only (already) | — | — |
| `PoolHistory` routine lines (snapshot, destroy of snapshots, hold, release, receive, finish receiving, clone swap, and their `ioctl` forms) | 14 days | delete; also skipped at ingest once older than 14 days | ~23 MB steady |
| `PoolHistory` other lines (pool create/import/export, dataset create/destroy/rename, `set`, scrub, upgrade) | forever | — | small |
| `ReplicationSync` | forever (drop the 400-day prune) | — | ~8 MB/yr |
| `DatasetReading` | 90 days | last per UTC day, forever (drop the 400-day prune) | ~1 MB/yr |
| `PoolReading` | 30 days | last per UTC day, forever | <0.1 MB/yr |
| `VdevReading` | forever (already sparse) | — | negligible |
| `SmartReading` + `SmartAttribute` | 30 days | last reading per disk per UTC day, forever | ~33 MB steady + ~21 MB/yr |
| `TemperatureReading` | 30 days | hourly max; after 1 year daily min and max (two rows) | ~15 MB steady + ~9 MB first year, ~1 MB/yr after |
| `Snapshot` | mirrors `zfs list` (already) | — | — |
| Faults, diary, acceptances, notifications, inventory | forever | — | — |

Steady state for this host is about 100 MB plus about 30 MB a year, against roughly 3.4 GB a year today.

### How

1. **Prune task.** A queueable `retention:prune` task runs daily at 03:00 via `scheduledTasks` and the queue. Node only: the Cloudflare demo does not run Nitro scheduled tasks and resets daily anyway. It has one function per rule, each deleting in batches of a few thousand rows so ingest is never blocked for long, and returns counts per table.
2. **Collapse rules** keep the last row of each UTC day (or hour), compared by `at`, then by `id`. For `SmartReading`, deleting a reading cascades its attributes, so the surviving reading carries a complete attribute set.
3. **"Newest per key" rules** (`CollectorRun`) keep the newest row per (host, source, device) whatever its age.
4. **`PoolHistory` classification** is a pure function over the line text, covering both the `zfs …` command lines and the multi-line `(NNms) ioctl …` records. It is unit-tested against captured `zpool history -il` fixtures; unknown lines count as non-routine, so they are kept.
5. **Don't re-insert what was pruned.** The collector re-sends overlapping tails every run: `zpool events` is the kernel ring buffer (default 512 events, more than 2 days on a quiet host), and `zfs-receives` sends the last 2000 receive lines (weeks of them on a busy host). Both are deduplicated by upsert, so a pruned row would come straight back.
   - `observeZpoolHistory` skips routine lines older than the 14-day cutoff.
   - `history_event` rows are only pruned below the oldest eid of the host's latest dump. Record that eid per host at ingest. This also keeps `checkContinuity`'s `maxStoredEidBelow` anchor in place, so no false "Missed ZFS events" gaps.
   - SCT temperature points older than 30 days are dropped at ingest. Today's buffers (478 samples at 1–59 min) stay inside 30 days, but a drive with a longer interval would re-insert collapsed hours.
6. **ZED runs.** `zed-event` runs are upserted to one row per host rather than inserted per event. Every reader wants the latest run, and diagnostics does not replay `zed-event`.
7. **Vacuum.** Not a migration: drizzle runs migrations in a transaction and `VACUUM` cannot run in one, and the Cloudflare bundle (Durable Object SQLite, no `VACUUM`) is built from the schema.
   - The first prune run deletes most of an existing database. Afterwards it sets `PRAGMA auto_vacuum = INCREMENTAL` if not already set and runs the existing `optimiseDatabase()` (`VACUUM`) once. That needs free disk equal to the DB size; note it in the release notes.
   - Later runs call `PRAGMA incremental_vacuum`.
8. **Tests.** Each rule gets a test over the seeded fleet (`*.seeded.test.ts`) that checks:
   - what survives;
   - the newest-per-key and baseline guarantees;
   - that a second run deletes nothing;
   - that re-ingesting the same collector bodies after a prune inserts nothing.
9. **Scrutiny re-import.** Imported `SmartReading` rows have no unique key, and the collapse can move a disk's earliest native reading later within a day. Dedupe the import on (diskId, takenAt, source) so a re-import cannot duplicate that day.
10. **Docs.** Put the policy table in [003](003-Architecture-and-data-model.md), replacing its "keep everything in v1", and remove the 400-day constants (`server/services/zfs/datasets.ts`, `server/services/replications/population.ts`).

### Knock-on effects to accept

- `valueSince` and `firstNonZeroAt` become day-precise beyond 30 days.
- A re-run of the fault backfill replays daily readings beyond 30 days, so a fault that opened and closed within a day more than 30 days ago may not be re-derived. Existing fault rows are untouched.
- A re-run of `backfillReplications` finds no receives older than 14 days. `ReplicationSync` already has them.
- Missed-event detection is unchanged: history events stay until they have left the kernel buffer.

## Decisions

- Full SMART detail for 30 days, not 14: it covers the 30 d chart and both trend windows at full resolution.
- Reviewed by Fable 2026-10-05. Findings folded in: history-event prune by eid, not age; no re-insertion of pruned rows at ingest; ZED runs upserted; vacuum outside migrations; Scrutiny re-import dedupe.
- Temperatures older than a year are stored as two ordinary rows per day, at the times of the day's minimum and maximum. `min`/`max` columns would save about 0.4 MB a year but give every reader (charts, faults, diagnostics) a second row shape; two rows keep one shape and the chart draws the daily range unchanged.
