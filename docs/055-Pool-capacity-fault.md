---
type: task
status: planned
---

# Pool capacity fault

Stub. A pool filling up is the most common way ZFS goes wrong at home, and tetanus says
nothing about it.

## Problem

ZFS has no hard cliff at 80 % or 90 %; those are rules of thumb. What actually
happens: performance degrades gradually as large free regions run out and
fragmentation climbs (worse on HDDs, where writes land on slower tracks); each
metaslab switches from first-fit to best-fit allocation when it drops below 4 % free
(`metaslab_df_free_pct`), which is CPU-heavy and cuts IOPS; and the pool reports
ENOSPC at about 97 % because 1/32 is reserved as slop (`spa_slop_shift`, capped at
128 GiB), at which point deletes that need to write metadata can fail. Fragmentation
(`frag`) predicts trouble at least as well as fill. Nothing in tetanus raises a fault,
alert or diary event as a pool approaches any of that. The user finds out from
the pool page's capacity figure, or from a failed write.

## Context

- `Pool.cap`, `allocBytes`, `freeBytes`, `frag` are stored on every `zpool-list`
  ingest (every 10 min); `PoolReading` keeps the history. Vdev-level `allocBytes` /
  `sizeBytes` / `frag` are on `Vdev`.
- Pool faults live in `server/services/poolFaults.ts`; kinds, titles and actions in
  `shared/faults.ts`; alert rules in `server/services/alerts/rules.ts`. `scrub-overdue`
  ([046](046-ZFS-fault-coverage.md)) is the nearest precedent: a per-pool setting with
  a default, a fault with recovery, a diary event once on entry.
- A `special` vdev or `dedup` vdev filling up is a different failure with the same
  shape; `Vdev.role` distinguishes them.
- [018 Capacity forecast](018-Capacity-forecast.md) is the "when will it be full"
  question; this is the "it is nearly full now" one.

## Questions

1. Thresholds: fixed (80/90), global setting, per pool, or per pool with a global default like scrub interval?
2. Does a nearly full special vdev count as the pool's fault or its own?
3. Fragmentation: worth a fault at all, or display only?
