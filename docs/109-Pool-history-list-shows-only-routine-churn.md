---
type: bug
status: done
---

# Pool history list shows only routine churn

On a host running sanoid and syncoid, the pool page's history list is all snapshot,
destroy, hold and receive lines. It covers the last few minutes, and the lines that
make up a pool's record never appear.

## Problem

`historyFor` in `server/services/zfs/queries.ts` returns the newest
`POOL_DETAIL_LIMIT` (50) `PoolHistory` rows for the pool, or for the host when no row
has a pool. In a prod snapshot (2026-11-16), mars writes about 21k history lines a day,
so 50 lines is about 3–4 minutes of churn. Pool create and import, dataset create,
destroy and rename, `set`, scrub and upgrade lines are kept forever by retention but
can't be seen.

Each operation also shows up to three times: the internal record (`snapshot
tank/a@x (txg)`), the multi-line `(NNms) ioctl snapshot …` record and the
`zfs snapshot tank/a@x` command line.

## Context

- `isRoutineHistory` (`server/services/zfs/history.ts`) already classifies lines as
  routine or not; retention uses it ([063](063-Retention-and-downsampling.md)).
  Classifying at query time would need either a stored column or filtering in JS over
  more rows than the limit.
- Snapshot and replication churn is already shown elsewhere: the snapshot list, and
  replication syncs (`ReplicationSync`).
- syncoid's `zfs rollback -R …@syncoid_…` lines and their ioctl records are not
  classed as routine; see [111](111-Pool-history-storage-volume.md).
- UI: `app/components/pool/Page.vue`.

## Decisions

Agreed 2026-11-16.

- **Hide routine lines by default**, with a toggle that shows the full stream. The
  toggle state goes in the URL query, like the tab.
- **Store `PoolHistory.routine`**, set by `isRoutineHistory` at ingest. Existing rows are
  reclassified at boot whenever the classifier version changes (the
  `smartPolicyVersion` pattern), so a new routine rule applies to old rows too. The
  retention prune selects on the column instead of re-running the regexes.
- **Hide `(NNms) ioctl …` records by default**, behind the same toggle. Internal records
  and `zfs` command lines stay. Stopping storing some forms is left to
  [111](111-Pool-history-storage-volume.md).
- **Page the list:** 50 lines at a time, with "Load older" (cursor on `at`, `id`).
  History loads lazily when its tab opens, like datasets, rather than with the pool.
- **syncoid rollbacks are routine**, pulled in from 111. syncoid rolls the target back
  to the newest common snapshot on every run (unless `--no-rollback`), so `zfs rollback
  … <target>@syncoid_…` and its `ioctl rollback` record are replication churn. A
  rollback to any other snapshot stays non-routine: it is a deliberate act.
