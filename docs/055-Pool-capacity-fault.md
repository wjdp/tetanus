---
type: task
status: planned
---

# Pool capacity fault

Stub. A pool filling up is the most common way ZFS goes wrong at home, and tetanus says
nothing about it.

## Problem

ZFS performance falls off past roughly 80 % and allocation turns pathological past
90 %; a full pool can refuse the deletes that would free space. Nothing in tetanus
raises a fault, alert or diary event as a pool approaches that. The user finds out from
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
