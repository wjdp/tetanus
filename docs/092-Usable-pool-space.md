---
type: task
status: in-progress
---

# Usable pool space

Decided 2026-10-05:

- **Usable space is the main pool figure everywhere:** the pool page, the pool list and the topology `PoolCard`.
  - It is shown as "X used · Y available".
  - The total `used + available` is never labelled "Size", because it moves (see Context).
- **The pool list swaps columns.** Its Size, Alloc and Free columns become Used and Available rather than gaining extra columns.
- **The pool page keeps the raw figures.** Raw `zpool` figures stay on it as a secondary row labelled "incl. parity".
- **The capacity bar stays on raw `cap`.** That's what the [055](055-Pool-capacity-fault.md) fault and the 80 % guidance use, and it is the only percentage on the list and `PoolCard`. Usable % appears only on the pool page, as text.
- **The capacity chart plots usable.** It shows usable used plus a ceiling line (`used + available`) in place of raw alloc.
- **Usable figures go on `PoolReading`.** They are written from each `zfs-list`, which keeps the chart at `PoolReading`'s resolution and 30-day retention.
- **Stale figures fall back to raw.** If the root dataset reading is older than the pool's latest `zpool` reading by more than one `zfs` cadence, it counts as missing. This covers `zfs-list` failing or the pool being recreated under the same name. Views then show the raw figures, labelled raw.

## Problem

Every pool size the app shows comes from `zpool list`: size, alloc, free and cap. On raidz those figures are raw, so they include parity and padding. A 6-wide raidz2 shows about 1.5× the space you can actually write, and free overstates the headroom by the same factor. On mirrors `zpool` already reports one side, so the two views roughly agree. The figure people want is the one `zfs list` gives for the pool's root dataset: how much is used and how much more can be written.

Showing usable space as the headline answers "how much room is left". The raw figures still matter for pool health: fragmentation, the capacity fault, and the slowdown as metaslabs fill all depend on raw allocation.

## Context

- **What the root dataset's `used` + `available` excludes.** It is space after parity, minus slop space (1/32 of the pool, capped at 128 GiB on OpenZFS 2.x) and minus any unused reservations. `available` is the real "can still write" figure.
- **raidz parity is an estimate.** `zfs` works it out assuming 128K records. Pools full of small blocks use more parity than it predicts, so usable used can drift from the real raw cost. Raw `cap` is what actually fills.
- **The usable total moves.** `used + available` shifts with:
  - unused reservations and refreservations on children, which shrink `available`;
  - a quota or refquota on the root, which caps `available`;
  - the raidz deflate ratio, fixed when the vdev was added;
  - raidz expansion on OpenZFS 2.3+, where existing data keeps the old parity ratio until it is rewritten, so usable is understated.
- **Special and dedup vdevs widen the gap.** They count in `zpool` size and alloc. Root `available` only reflects the normal storage class, so usable is noticeably below raw minus parity on such pools. Log, cache and spare vdevs are in neither figure.
- **Today the data is only in `DatasetReading`.** It keeps `used` and `available` for every dataset, the root included, but only records a reading when the UTC day changes or used moves by more than 1 % (`readingDue` in `datasets.ts`), and keeps them 90 days.
  - `PoolReading` is written on every `zpool-status` ingest (`recordPoolReading` in `topology.ts`) and kept 30 days (`POOL_READING_DAYS`).
  - `zfs-list` and `zpool-list` share the `zfs` cadence group (`shared/hostFreshness.ts`), but arrive as separate posts.
- **How the root dataset is found.** It is the dataset with `name = pool.name` and `present`. Use that, not `parentId IS NULL`: `resolveParents` also nulls orphans.
  - `zfs-list` matches pools by name (`newestPoolByName`) and only marks datasets absent when it sees the pool without them. A failed `zfs-list` therefore leaves the old root `present` with stale figures.
- **The demo posts `zfs-list` sparsely.** It only does so on daily grid instants in the last 40 days ([089](089-Dataset-space-treemap.md)).
- **The treemap already uses root `available`.** [089](089-Dataset-space-treemap.md)'s free tile does, so keep the two consistent.
- **Where the change lands:**
  - Pool reads in `server/services/zfs/queries.ts` (`listPools`, `getPool`) and `topology.ts`. None of these return dataset figures today.
  - Pool page capacity panel and chart: `app/pages/zfs/[id].vue`.
  - Pool list columns: `app/pages/zfs/index.vue`.
  - `app/components/topology/PoolCard.vue`, which shows "alloc of size".
- **Units follow the TiB/TB toggle** ([091](091-Binary-units-for-ZFS-sizes.md)).
- **Related:** [018](018-Capacity-forecast.md) Capacity forecast should forecast usable `available`, not raw free.
