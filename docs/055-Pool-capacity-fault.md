---
type: task
status: todo
---

# Pool capacity fault

A pool filling up is the most common way ZFS goes wrong at home, and tetanus says
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

## Design

Designed alongside [057 Temperature fault](057-Temperature-fault.md) and reuses its
threshold helper, live-row context and alerting change; build after 057.

- **Kind** `pool-capacity`: category `zfs`, subject `pool`, lifetime `transient`,
  actions acknowledge / accept / clear. Not in `DIARY_SILENT_KINDS`. Title like
  `Pool tank 91 % full · frag 34 %`, falling back to `Pool nearly full` when `data` is
  empty.
- **Thresholds**: warning 80 %, error 90 %, per pool in `poolConfigSchema`
  (`capacityWarningPct`, `capacityErrorPct`), defaults in `POOL_CONFIG_DEFAULTS`, editable
  in `ConfigPopover`, as `scrubIntervalDays`. 0 for warning disables, matching the other
  pool settings. The patch schema is per field, so the service checks warning < error
  against the resolved config and throws `ServiceError` 400.
- **Value**: `Pool.cap` (integer percent) from the latest `zpool-list`. Opens on a single
  reading; fill changes slowly.
- **Hysteresis, both edges**: margin 2 percentage points, via `thresholdSeverity`.
- **Special/dedup vdevs**: same kind, one fault per top-level vdev (parent is the root
  vdev, as `detectVdevUnredundant`) with role `special` or `dedup`. Percent is
  `Math.floor(100 × allocBytes / sizeBytes)`; skip when `sizeBytes` is null. Key
  `String(poolId)` for the pool, `leafKey(poolId, guid)` for a vdev, so `dataFromKey`
  recovers the GUID. A replaced special gets a new GUID and its old fault resolves. The
  title names the vdev and role.
- **Fragmentation**: display only, in the fault data and title.
- **Host silence**: add `pool-capacity` to `POOL_FAULT_KINDS` so `collector-silent`
  supersedes it. Archived and missing pools are skipped, as for other pool faults.
- **Severity, accept, alerts**: as 057. Severity moves up within the same fault; generic
  `accepted` state; `ALERT_RULES` plus the fault-kind/alert-rule test map; alert on
  open and on `fault-severity-raised`.
- **Simulator**: mark `nearly-full` ✱ → `pool-capacity` in
  [044](044-Fault-simulator.md) (rename if useful). Add a `special-nearly-full` scenario
  that applies when the pool has a special or dedup top-level vdev and sets its
  `alloc_space` in the `zpool-status` payload; there isn't one today.
