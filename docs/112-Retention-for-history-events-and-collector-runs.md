---
type: task
status: todo
---

# Retention for history events and collector runs

`ZfsEvent` and `CollectorRun` each hold about twice their estimated steady size, or
much more than that, because two assumptions in
[063](063-Retention-and-downsampling.md) don't hold on a busy host.

## Problem

From a prod snapshot (2026-11-16, retention running, windows full):

| Table | Actual | 063 estimate |
|---|---|---|
| `ZfsEvent` | 16 MB, 33k rows | about 512 rows per host |
| `CollectorRun` | 19 MB, 178k rows | about 9 MB |

- **`ZfsEvent`.** A `history_event` is pruned only when it is older than
  `HISTORY_EVENT_DAYS` (2) **and** below the host's `zpoolEventsOldestEid - 1`. 063
  assumed the kernel ring buffer spans more than 2 days. On mars it holds about 1,000
  events, which is about 2 hours at roughly 12k events a day. So the age rule decides,
  and 25k rows are kept on mars, all of which the host will never re-send.
- **`CollectorRun`.** Four hosts, with the zfs group every 10 min and the SMART and
  hardware groups hourly, give about 6k rows a day. Every run is kept for
  `COLLECTOR_RUN_DAYS` (30). About 9k of the 178k rows are permanent failures of an
  optional source ([110](110-Missing-vdevidconf-reported-as-a-failed-source.md)).

## Context

- Rules: `pruneHistoryEvents` and `pruneCollectorRuns` in
  `server/services/retention.ts`; periods in `shared/retention.ts`; user-facing copy in
  `RETENTION_RULES`.
- History events are kept for one purpose: `checkContinuity`
  (`server/services/zfs/events.ts`) needs the eid just below the dump's oldest
  (`maxStoredEidBelow`), plus the eids still in the buffer for dedupe.
  [063](063-Retention-and-downsampling.md) also said nothing else reads them because
  they carry no pool GUID. That is no longer true: since 2026-11-01 they do, so the
  pool page's Events tab lists them. [114](114-Pool-events-list-shows-only-history-events.md)
  hides them there by default, behind a toggle. They duplicate `PoolHistory`, so
  pruning them loses nothing the Events tab needs. The reset bug in
  [107](107-False-ZFS-event-resets-after-a-reboot.md) depends on stored eids too;
  settle it first, or at least check that this change doesn't make it worse.
  Settled: resets no longer read stored event times, and the reset and gap checks
  compare each dump with the previous dump's eid range on `Host`. Since 2026-10-27,
  mars's buffer holds 1,024 events, about 1.7 hours
  ([108](108-Missed-ZFS-events-gap-repeated-on-every-dump.md)).
- Collector run readers:
  - last seen and source status, which only need the latest run per (host, source,
    device);
  - diagnostics export (`DIAGNOSTICS_WINDOW_DAYS = 30`,
    `server/services/diagnostics.ts`);
  - the host page source list ([079](079-Unsupported-OpenZFS-fails-silently.md)).
- `zed-event` runs are already upserted to one row per host.

## Decisions to make

- `ZfsEvent`: drop the age condition, so history events go as soon as they are below
  the buffer's oldest eid (keeping the anchor)? Or keep a short floor, such as a few
  hours, as a safety margin? It's unclear what the 2 days protected.
- `CollectorRun`: options:
  - cut the period to 7 days;
  - keep only failed runs and runs whose `ok` differs from the previous run of the
    same source, plus the newest per key;
  - stop inserting a row per run and keep a per-source summary (last ok, last failure,
    counts).
- If the period gets shorter, should the diagnostics window shrink to match? What does
  someone reading a diagnostics export actually use from 30 days of runs?
- Expected result: steady size about 100 MB for mars, as 063 intended, together with
  [111](111-Pool-history-storage-volume.md). Update the cost table in 063/003 once
  decided.
