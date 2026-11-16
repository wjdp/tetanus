---
type: bug
status: todo
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

## Decisions to make

- Hide routine lines by default with a toggle to show them, or never show them on the
  pool page?
- Store a `routine` boolean on `PoolHistory` at ingest (needs a migration and a
  backfill) or filter in the query by text pattern?
- Show one line per operation (for example only the `zfs …` command line, or only the
  internal record) instead of all three? This overlaps
  [111](111-Pool-history-storage-volume.md), which may stop storing some forms.
- Does the limit of 50 still fit once churn is hidden, or should the list page by date?
