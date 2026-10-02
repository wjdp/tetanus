---
type: task
status: todo
---

# ZFS fault coverage

Review of every ZFS failure mode against what tetanus detects, and the faults that
should exist. Today only two ZFS kinds exist ([036](036-Faults-page.md)):
`pool-degraded` and `scan-errors`. A `FAULTED` leaf raises nothing red, leaf error
counters and permanent data errors raise nothing, and a scrub can be years old
unnoticed.

Principle: **no near-duplicates.** A pulled disk should not show `disk-missing`, a
leaf `REMOVED` fault and `pool degraded`: three rows restating one observation. Faults
that restate the same observation fold into one (§Folding). Faults that are different
evidence stay separate even when related: a disk failing SMART and the pool it
degrades are two faults.

Absorbs the pool half of [017](017-Scrub-and-self-test-overdue.md) (scrub overdue);
017 keeps the SMART self-test half.

## Today

| condition | collected | stored | shown on `/zfs/:id` | fault |
| --- | --- | --- | --- | --- |
| pool `DEGRADED` / `OFFLINE` / `REMOVED` | yes | `Pool.state` | badge (amber) | `pool-degraded`, warning: on the faults page, but not in the banner or nav badge (open errors only) |
| pool `FAULTED` / `UNAVAIL` / `SUSPENDED` | yes | `Pool.state` | badge (red) | `pool-degraded`, error |
| leaf `FAULTED` / `UNAVAIL` / `REMOVED` / `OFFLINE` | yes | `Vdev.state`, `VdevReading` | vdev table | none of its own; only the pool's state |
| cache / log / spare leaf failed, pool `ONLINE` | log, cache yes; spares no | partly | partly | none |
| leaf read / write / checksum errors | yes | `Vdev.*Errors`, `VdevReading` (on change) | vdev table, current value only | none |
| leaf slow I/Os | yes (`-s`) | `Vdev.slowIos`, `VdevReading` | vdev table | none |
| permanent data errors (`error_count`) | yes | `Pool.errors` | no | none |
| damaged file list (`errlist`) | yes (collector is root) | not parsed | no | n/a |
| status message id (`msgid`, `moreinfo`, e.g. `ZFS-8000-8A`) | yes | not parsed | no (status / action text only) | n/a |
| scrub found unrepaired errors | yes | `Pool.scan.errors`, diary `scrub-finished` | scan panel (amber) | `scan-errors`, error |
| scrub repaired data (`processed` > 0) | yes | `Pool.scan.processed`, not in diary | no | none |
| scrub cancelled | yes | `Pool.scan.state` | state text | none, no diary |
| scrub overdue / never run | derivable | current scan only; history in diary | no | none |
| finished scan at first sighting | yes | `Pool.scan` | yes | none (no diary entry, so no `scan-errors`) |
| pool vanishes (failed import, export) | absence | `Pool.lastSeenAt` | no | resolves its faults |
| device removal (`removal_stats`) | yes | not parsed | no | n/a |
| spares section (`AVAIL` / `INUSE` / `UNAVAIL`) | yes | not parsed (044 gaps) | no | none |
| `zpool events` / ZED ereports | yes | `ZfsEvent` | class, eid, raw vdev guid | none |

## Folding

Only where one fault restates another; the folded fault is not opened and its facts go
in the remaining fault's `data`:

1. `collector-silent` (host) suppresses everything on the host (as
   [045](045-Silent-host-does-not-make-its-disks-missing.md)).
2. `pool-missing` suppresses `pool-degraded`, `disk-missing` and leaf faults for its
   member disks.
3. `pool-degraded` suppresses `disk-missing` for disks whose leaf it lists, and
   `leaf-errors` / `leaf-slow` for those leaves (their counters go in its data).
4. `leaf-errors`, `leaf-slow`, `pool-data-errors`, `scrub-overdue`: independent.

Not folded, because they are different evidence: SMART faults on a leaf's disk
(the drive's own view, persistent), `pool-data-errors` (damaged data, not device
state), `scrub-overdue`. A suppressed fault is not opened; one already live when its
cause appears resolves (diary `fault-resolved` with `data.supersededBy`), and reopens as
a new occurrence if the cause clears first.

## Proposed faults

| kind | subject / key | trigger | severity | lifetime | actions |
| --- | --- | --- | --- | --- | --- |
| `pool-degraded` (broadened) | pool / `poolId` | pool ≠ `ONLINE`, or any leaf (incl. log, cache, special, spare) ≠ `ONLINE` (spares: ≠ `AVAIL`/`INUSE`) | worst `zfsStateColour` of pool and listed leaves: `DEGRADED` pool with `OFFLINE` leaf amber; any `FAULTED`, `UNAVAIL`, `SUSPENDED` red | transient | ack, accept, clear |
| `pool-missing` (new) | pool / `poolId` | pool absent from a fresh `zpool-status` on a reporting host | warning | until seen again | ack, accept, clear |
| `leaf-errors` (new) | pool / `poolId:vdevGuid` | `ONLINE` leaf with any of R / W / C > 0 | error | until counters reset (`zpool clear`); ack level-based, reopens on rise | ack, accept, clear |
| `leaf-slow` (new) | pool / `poolId:vdevGuid` | slow I/Os rise ≥ pool threshold within 24 h | warning | until a 24 h window under threshold | ack, accept, clear |
| `pool-data-errors` (replaces `scan-errors`) | pool / `poolId` | `Pool.errors` > 0, or latest finished scan `errors` > 0 | error | until both are 0 | ack, clear |
| `scrub-overdue` (new) | pool / `poolId` | no finished scrub within the pool's interval (default 35 d); never-scrubbed pools count from `firstSeenAt` | warning | transient | ack, accept, clear |

Notes:

- `pool-degraded` keeps its kind name; title from data: `Pool tank DEGRADED: K3
  FAULTED` / `Pool zeta: cache C1 UNAVAIL` / `… K3 REMOVED (disk missing)`. Data:
  `{ state, poolName, leaves: [{ vdevGuid, name, state, role, diskId, diskMissing,
  read, write, checksum }] }`. Reopens an acknowledged or accepted row on a severity
  rise (as today) **or a new leaf in the list**.
- Pool badge colour unchanged: `DEGRADED` stays amber, red reserved for `FAULTED`,
  `UNAVAIL`, `SUSPENDED`. A `FAULTED` leaf makes the fault red while the pool badge
  stays amber.
- Repaired-but-no-errors scrubs are not their own fault: repairs come from checksum
  errors, which `leaf-errors` already raises on the leaf that caused them. Shown on the
  scan panel.
- `pool-data-errors` merges `scan-errors` and `error_count`, which describe the same
  damaged data. Data migration renames live `scan-errors` rows; backfill maps old
  scan entries to the new kind.
- `leaf-errors` title `A7 in tank: R 0 W 0 C 12, +4 in 24 h` (delta from
  `VdevReading`). Level-based ack as [042](042-Acknowledge-faults.md), stored on the
  fault (`data.acknowledgedCounts`) since `FaultAcceptance` is SMART-keyed.
- `pool-missing` for a deliberate export: accept. It stays accepted until the pool is
  seen again; no forget-pool action in this task.
- Not faults: resilver running (info, 037), spare `INUSE` (listed in `pool-degraded`),
  fragmentation, ereports (counters cover them; shown in detail).

## Changes

### Per-pool config

`Pool.config` json (zod schema in `shared/schemas/pools.ts`): `scrubIntervalDays`
(default 35, 0 disables), `slowIoThreshold` (default 10 per 24 h, 0 disables). Edited
on the pool page (settings popover in the header). `PATCH /api/pools/:id/config`.
Defaults in `shared/` so client and server agree.

### Ingest / parse (`server/ingest/zpool-status.ts`)

- Parse spares (and check `l2cache`) under `--json-flat-vdevs`; spare leaves get
  `AVAIL` / `INUSE` / `UNAVAIL`. Capture a fixture from a pool with a spare (file-backed
  pool on mars is enough).
- Parse `errlist` to `Pool.damagedFiles` (string array, capped at 100; a string value
  such as `"Permission denied"` stored as `damagedFilesError`). Fixtures
  `test/fixtures/mars/zpool-status-errlist.json` (root) and
  `zpool-status-errlist-unprivileged.json`, from the author's `tfault` test pool (file
  vdev, `error_count` 1, cksum 6, scrub `errors` 1).
- Parse `msgid` and `moreinfo` to `Pool.msgid`, `Pool.moreinfo`.
- Parse `removal_stats` (state, vdev, copied, to_copy, start / end, mapping memory) to
  `Pool.removal` json.
- Diary `*-finished` data gains `repairedBytes` (`processed`), `startTime`.
- Diary `scrub-cancelled` on transition to `CANCELED`.
- First sighting with a finished scan writes its `*-finished` entry.

### Data

- `Pool.damagedFiles` json, `damagedFilesError`, `msgid`, `moreinfo`.
- `Pool.lastScrub` json `{ endAt, errors, repairedBytes, durationS }`, written when a
  `SCRUB` finishes, so a resilver replacing `Pool.scan` keeps it.
- `Pool.config`, `Pool.removal`.
- One migration `pool_scrub_config_removal`; data step renames `scan-errors` →
  `pool-data-errors` in `Fault` and `scan-errors` alert rule references.
- Diary `leaf-errors-changed` on 0 → n and on rise (one per leaf per ingest, data
  `{ poolId, vdevGuid, from, to }`); `pool-data-errors-changed` likewise. Feed alerts
  and backfill.

### Faults (`server/services/faults.ts`, `shared/faults.ts`)

- Detectors run in cause order and pass a suppression set down (host → pool → leaf /
  disk). `disk-missing` detector consults it; that also fixes the triple fault for a
  pulled pool disk.
- Kind definitions per the table; `scan-errors` removed from `FAULT_KINDS`.
- Reopen rule for `pool-degraded` extended to leaf set growth.
- Backfill: `vdev-state-changed` into `pool-degraded` leaves; `leaf-errors-changed`
  → `leaf-errors`; `pool-missing` has no trail (gap, starts at final sync).

### Alerts (`server/services/alerts/rules.ts`)

- `pool-degraded`: also fires on `vdev-state-changed` to a bad state when the pool stays
  `ONLINE` (cache / spare / log).
- New: `leaf-errors`, `pool-data-errors` (replaces `scan-errors`), `pool-missing`,
  `scrub-overdue`, `leaf-slow` (notice severity).
- Rule ↔ kind mapping test updated.

### Pool page (`app/pages/zfs/[id].vue`)

Collected but not shown today:

- Live faults for the pool above the panels (faults list filtered by subject).
- `Pool.errors`: "Data errors N" in the header, red when > 0, with the damaged file
  list (collapsed past 10).
- `msgid` as a link to `moreinfo` beside the status text.
- Scan panel: repaired bytes, duration, last scrub (from `lastScrub`) beside the
  current scan, "Scrub overdue" warning text with the interval, cancelled state.
- Removal panel when `Pool.removal` present (the `remove:` block).
- Vdev table: spares rows; path / devid / phys path on hover; per-vdev alloc / size /
  frag (stored, unused); slow I/Os amber over threshold.
- Error and slow I/O history per leaf from `VdevReading` (expandable row with a small
  chart).
- Events tab: resolve `vdevGuid` to leaf name and disk link; expand a row to its
  `payload` (`zio_err`, `zio_offset`, `vdev_path`, delay).
- Config popover (§Per-pool config).

### Simulator

Each 044 pool scenario asserts its single fault:

| scenario | fault |
| --- | --- |
| leaf fails `FAULTED` / `UNAVAIL` | `pool-degraded` red, leaf listed |
| leaf fails `OFFLINE` / `REMOVED` | `pool-degraded` amber |
| pool suspended | `pool-degraded` red |
| spare in use | `pool-degraded`, failed leaf and `INUSE` spare listed |
| scrub found errors | `pool-data-errors` |
| checksum errors on a leaf | `leaf-errors` |
| permanent errors | `pool-data-errors` |
| scrub overdue | `scrub-overdue` |
| error burst | none (events only) |

New scenarios: cache device fails on an `ONLINE` pool (`pool-degraded`); pool vanishes
(`pool-missing`); slow I/Os (`leaf-slow`); pulled disk (`pool-degraded` only, no
`disk-missing`).

### Demo

Seed: a leaf with checksum errors acknowledged at 12; a pool with a scrub overdue;
vault `DEGRADED` story lists its leaf.

### Docs on landing

037 ZFS state (fault severity vs badge colour) and scan tables; 036 kinds table and
future kinds (017 scrub row); 044 gaps; 017 pool half done.

## Steps

1. Parser: spares, `removal_stats`; fixtures.
2. Migration: `Pool.lastScrub`, `config`, `removal`; `scan-errors` rename.
3. Topology: last scrub, first-sighting scan entry, `scrub-cancelled`,
   `leaf-errors-changed`, `pool-data-errors-changed`.
4. Folding in sync; `disk-missing` suppression; tests.
5. Kinds: broadened `pool-degraded`, `pool-missing`, `leaf-errors`, `leaf-slow`,
   `pool-data-errors`, `scrub-overdue`; backfill; tests.
6. Pool config API and popover.
7. Alert rules and mapping test.
8. Pool page additions; component tests.
9. Simulator assertions and new scenarios; demo seed; docs.

## Open questions

None. Decided 2026-10-02: `-j -v` carries `errlist` (key present on `tfault`), so parse it (array of paths as root, the string `"Permission denied"` otherwise); `pool-missing` warning; slow I/O default 10 per 24 h, tune once
mars has data; SMART faults stay separate from pool faults.
