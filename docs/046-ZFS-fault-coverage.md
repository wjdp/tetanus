---
type: task
status: todo
---

# ZFS fault coverage

Review of every ZFS failure mode against what tetanus detects, and the faults that
should exist. Today only two ZFS kinds exist ([036](036-Faults-page.md)):
`pool-degraded` (warning for `DEGRADED`) and `scan-errors`. A `FAULTED` leaf, leaf
error counters and permanent data errors raise nothing of their own; a degraded pool is
amber.

Absorbs the pool half of [017](017-Scrub-and-self-test-overdue.md) (scrub overdue);
017 keeps the SMART self-test half.

## Today

| condition | collected | stored | shown on `/zfs/:id` | fault |
| --- | --- | --- | --- | --- |
| pool `DEGRADED` / `OFFLINE` / `REMOVED` | yes | `Pool.state` | badge (amber) | `pool-degraded`, warning |
| pool `FAULTED` / `UNAVAIL` / `SUSPENDED` | yes | `Pool.state` | badge (red) | `pool-degraded`, error |
| leaf `FAULTED` / `UNAVAIL` / `REMOVED` / `OFFLINE` | yes | `Vdev.state`, `VdevReading` | vdev table | none (only via pool state) |
| cache / log / spare leaf failed, pool `ONLINE` | log, cache yes; spares no | partly | partly | none |
| leaf read / write / checksum errors | yes | `Vdev.*Errors`, `VdevReading` (on change) | vdev table, current value only | none |
| leaf slow I/Os | yes (`-s`) | `Vdev.slowIos` | vdev table | none |
| permanent data errors (`error_count`) | yes | `Pool.errors` | no | none |
| scrub found unrepaired errors | yes | `Pool.scan.errors`, diary `scrub-finished` | scan panel (amber) | `scan-errors`, error |
| scrub repaired data (`processed` > 0, errors 0) | yes | `Pool.scan.processed`, not in diary | no | none |
| scrub cancelled | yes | `Pool.scan.state` | state text | none, no diary |
| scrub overdue / never run | derivable | current scan only; history via diary | no | none |
| first sighting of a finished scan | yes | `Pool.scan` | yes | none (no diary entry, so no `scan-errors`) |
| pool vanishes (failed import, export) | absence | `Pool.lastSeenAt` | no | resolves its faults |
| device removal (`removal_stats`) | yes | not parsed | no | n/a |
| spares section (`AVAIL` / `INUSE` / `UNAVAIL`) | yes | not parsed (044 gaps) | no | none |
| `zpool events` ereports (checksum, io, data, delay, deadman) | yes | `ZfsEvent` | class, eid, vdev guid | none |
| `zed-event` | yes | `ZfsEvent` | as above | none |

## Proposed faults

| kind | subject / key | trigger | severity | lifetime | actions |
| --- | --- | --- | --- | --- | --- |
| `pool-degraded` (changed) | pool / `poolId` | state ≠ `ONLINE` | **error** for every non-`ONLINE` state | transient | ack, accept, clear |
| `leaf-state` (new) | pool / `poolId:vdevGuid` | leaf (disk / file, incl. log, cache, spare members) state ≠ `ONLINE`, spares ≠ `AVAIL`/`INUSE` | error: `FAULTED`, `UNAVAIL`, `REMOVED`; warning: `OFFLINE` | transient | ack, accept, clear |
| `leaf-errors` (new) | pool / `poolId:vdevGuid` | any of R / W / C > 0 | error | until counters reset (`zpool clear`); ack level-based, reopens on rise | ack, accept, clear |
| `pool-data-errors` (new) | pool / `poolId` | `Pool.errors` > 0 | error | until 0; reopens on rise | ack, clear |
| `scan-errors` (changed) | pool / `poolId` | latest finished scan: errors > 0 → error; repaired bytes > 0 → warning | as left | until a clean scan | ack, clear |
| `scrub-overdue` (new) | pool / `poolId` | no finished scrub within threshold (default 35 d), or none since first seen + threshold | warning | transient | ack, accept, clear |
| `pool-vanished` (new, see Q2) | pool / `poolId` | pool absent from a fresh `zpool-status` on a reporting host | warning | until seen again or disposed | ack, accept, clear |

Not faults: resilver running (info, 037), spare `INUSE` (info; `leaf-state` on the
failed leaf carries it), slow I/Os (shown only; see Q3), fragmentation, ereports
(counters already cover them; shown in detail instead).

`leaf-errors` data: `{ leaf, diskId, read, write, checksum, delta24h }` from
`VdevReading`; title `A7 in tank: R 0 W 0 C 12, +4 in 24 h`. Level-based ack as
[042](042-Acknowledge-faults.md): stores acknowledged totals, reopens when any rises.
Store on the fault row (`data.acknowledgedAt`) rather than `FaultAcceptance`, which is
SMART-keyed.

`leaf-state` and `leaf-errors` link to the disk page when `Vdev.diskId` is set; subject
stays the pool, since an `UNAVAIL` leaf often has no resolvable disk.

## Changes

### Severity

- `ZFS_STATE_COLOUR.DEGRADED` → `error`. `OFFLINE` and `REMOVED` stay warning as leaf
  colours (administrative / transient), but pool-level any non-`ONLINE` is an error.
  `poolSeverity` returns error unconditionally; drop the `zfsStateColour` dependency.
- 037 ZFS state and scan tables updated; `scan-errors` with unrepaired errors red, not
  amber, on the scan panel.

### Ingest / parse (`server/ingest/zpool-status.ts`)

- Parse `spares` (and check `l2cache`) under `--json-flat-vdevs`; spares get
  `type: "spare"` leaves with `AVAIL` / `INUSE` / `UNAVAIL`.
- Parse `removal_stats` (state, vdev, copied, to_copy, end time, mapping memory) to
  `Pool.removal` json.
- Keep `scan.processed` (already parsed) in diary `*-finished` data as `repairedBytes`.
- Diary `scrub-cancelled` on transition to `CANCELED`.
- First sighting with a finished scan writes the `*-finished` entry, so `scan-errors`
  and overdue work for pools tetanus has just met.

### Data

- `Pool.lastScrubAt`, `Pool.lastScrubErrors`, `Pool.lastScrubRepaired`: updated when a
  `SCRUB` finishes, so a later resilver replacing `Pool.scan` does not lose them.
  Migration `pool_last_scrub`.
- `Pool.scrubIntervalDays` nullable override (null → setting default 35; 0 disables).
- Diary `leaf-errors-changed` on 0 → n and on rise (one per ingest, not per counter),
  `data: { vdevGuid, from, to }`; `pool-data-errors-changed` likewise. Feeds alerts and
  backfill.

### Faults (`server/services/faults.ts`, `shared/faults.ts`)

- Detectors over `currentPools()` plus their present leaves.
- Kind definitions as table above; `FAULT_KINDS` order: pool kinds together.
- Backfill replay: `vdev-state-changed` → `leaf-state`; `leaf-errors-changed` →
  `leaf-errors`; scan entries with `repairedBytes`. Gaps start at final sync.

### Alerts (`server/services/alerts/rules.ts`)

- `pool-degraded` rule severity follows fault severity (now always alert).
- New rules: `leaf-faulted` (`vdev-state-changed` to a bad state), `leaf-errors`
  (`leaf-errors-changed`), `pool-data-errors`, `scrub-overdue` (on fault open).
- Update the rule ↔ kind mapping test.

### Pool page (`app/pages/zfs/[id].vue`)

Collected but not shown today, to add:

- `Pool.errors`: "Data errors: N" in header, red when > 0.
- Scan panel: repaired bytes, duration, last scrub (from `lastScrubAt`) separate from
  current scan, "overdue" warning text, cancelled state.
- Removal panel when `Pool.removal` present (the `remove:` block).
- Vdev table: path / devid on hover, per-vdev alloc / size / frag (stored, unused),
  spares rows.
- Error counter history from `VdevReading`: sparkline or expandable row per leaf.
- Events tab: resolve `vdevGuid` to leaf name / disk; expand row to `payload`
  (`zio_err`, `zio_offset`, `vdev_path`, delay ms).
- Live faults for the pool at the top (reuse faults list component, filter
  `subject`).

### Simulator

Each 044 pool scenario now opens a fault; tests assert it:

| scenario | fault |
| --- | --- |
| leaf fails | `pool-degraded` error + `leaf-state` |
| pool suspended | `pool-degraded` error |
| spare in use | `pool-degraded` + `leaf-state` (failed leaf) |
| scrub found errors | `scan-errors` error |
| checksum errors on a leaf | `leaf-errors` |
| permanent errors | `pool-data-errors` |
| scrub overdue | `scrub-overdue` |
| error burst | none (events only); counters scenario covers it |

New scenario: scrub repaired data, no errors → `scan-errors` warning.

### Demo

Seed: one leaf with checksum errors acknowledged at 12; one pool with a scrub overdue;
vault `DEGRADED` story now red.

## Steps

1. Severity change (`ZFS_STATE_COLOUR`, `poolSeverity`), 037 update, tests.
2. Parser: spares, `removal_stats`; fixtures from simulator payloads where none
   captured.
3. Migration `pool_last_scrub`; topology writes last scrub, first-sighting scan entry,
   `scrub-cancelled`, `leaf-errors-changed`, `pool-data-errors-changed`.
4. Fault kinds and detectors: `leaf-state`, `leaf-errors`, `pool-data-errors`,
   `scan-errors` repaired, `scrub-overdue`; backfill; tests.
5. Alert rules and mapping test.
6. Pool page additions; component tests.
7. Simulator assertions and new scenario; demo seed.
8. Mark 017 pool half done; 044 gaps updated.

## Unanswered questions

1. `leaf-state` and `leaf-errors` subject: pool (proposed, works for unresolvable
   leaves) or disk (shows on the disk page, follows the disk across pools)?
2. `pool-vanished`: wanted? A failed import looks the same as a deliberate
   `zpool export`; accept would cover the export case.
3. Slow I/Os: fault (warning above N per day) or display only?
4. A pulled disk gives `disk-missing` + `leaf-state` + `pool-degraded`, three red
   faults for one event. Fine, or nest `leaf-state` under `pool-degraded` (one fault,
   leaves listed in data)? Nesting loses cache / spare failures on an `ONLINE` pool.
5. `leaf-errors` threshold: any non-zero (proposed), or let a single historic checksum
   error be accepted and only rises reopen? (Accept covers this.)
6. Scrub overdue default 35 d OK? Per-pool override in pool page or settings page?
7. Does `zpool status -j -v` include the permanent-error file list on our OpenZFS
   version? If so, parse and show it.
