---
type: bug
status: done
---

# Pool events list shows only history events

On a host running sanoid and syncoid, the pool page's Events tab is all
`sysevent.fs.zfs.history_event`, so error reports, scrub, trim and import events can't
be found. This is the same problem as the History tab had
([109](109-Pool-history-list-shows-only-routine-churn.md)).

## Problem

In a prod snapshot (2026-11-16), mars's main pool has about 14.8k events. Nearly all
are `history_event`: the ZED copy of each `zpool history -i` record (snapshot, destroy,
hold, release, receive). The other classes (`config_sync`, `pool_import`,
`scrub_start`/`scrub_finish`, `ereport.fs.zfs.*`) amount to a few dozen in total.
The Events tab lists events newest first, so its pages are all snapshot churn, and the
tab badge counts it.

## Context

- [063](063-Retention-and-downsampling.md) assumed history events carry no pool GUID,
  so `recentEvents` (now `listPoolEvents`, `server/services/zfs/queries.ts`), which
  selects by `poolGuid`, would never show them. That no longer holds: every history
  event stored since 2026-11-01 has a pool GUID, and so do all other classes. Possible
  causes are OpenZFS 2.4 or a change in how tetanus reads `pool_guid`; it doesn't
  matter for the fix.
- History events duplicate `PoolHistory`, which the History tab already shows readably
  and filtered.
- History events are kept at least while they are in the kernel ring buffer (about
  1,000 events, roughly 2 hours, on mars), so tighter retention
  ([112](112-Retention-for-history-events-and-collector-runs.md)) can't stop them
  filling the newest pages.
- Events are paged with the shared `(at, id)` cursor; `ZfsEvent_poolGuid_at_idx`
  serves the query and the badge count (`eventCount`).

## Decisions

Agreed 2026-11-16.

- **Hide history events by default**, with a "Show history events" switch on the tab.
  Its state goes in the URL query, as with the History tab's toggle.
- **Filter on the server** so paging stays correct, and make the tab badge count what
  the default view shows.
