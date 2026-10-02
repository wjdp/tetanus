---
type: task
status: in-progress
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
| status message id (`msgid`, `moreinfo`, e.g. `ZFS-8000-8A`) | yes | not parsed | no (status / action text only) | none; codes not covered by another kind (e.g. `EY` hostid mismatch, `K4` intent log) raise nothing |
| scrub found unrepaired errors | yes | `Pool.scan.errors`, diary `scrub-finished` | scan panel (amber) | `scan-errors`, error |
| scrub repaired data (`processed` > 0) | yes | `Pool.scan.processed`, not in diary | no | none |
| scrub cancelled | yes | `Pool.scan.state` | state text | none, no diary |
| scrub overdue / never run | derivable | current scan only; history in diary | no | none |
| scrub paused (`scrub_pause` epoch) | yes | not parsed | no | none |
| scrub / resilver stalled (no progress in `examined` / `issued`) | yes, per reading | current scan only, no history | no | none |
| single-device `special` / `dedup` vdev (losing it loses the pool) | yes | `Vdev.role`, parent | topology card | none |
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
| `leaf-errors` (new) | pool / `poolId:vdevGuid` | `ONLINE` leaf, or any group vdev (mirror, raidz, root), with any of R / W / C > 0 | warning on a leaf; error on a group (unrecoverable reconstruction) | until resolved by hand or the vdev leaves the pool; counters falling (reboot, import, `zpool clear`) never resolve it; ack level-based on the running total of rises | ack, accept, clear, resolve |
| `leaf-slow` (new) | pool / `poolId:vdevGuid` | slow I/Os rise ≥ pool threshold within 24 h | warning | until a 24 h window under threshold | ack, accept, clear |
| `pool-data-errors` (replaces `scan-errors`) | pool / `poolId` | `Pool.errors` > 0, or latest finished scan `errors` > 0 | error | until both are 0 | ack, clear |
| `scrub-overdue` (new) | pool / `poolId` | no finished scrub within the pool's interval (default 35 d); never-scrubbed pools count from `firstSeenAt` | warning | transient | ack, accept, clear |
| `pool-status` (new, part C) | pool / `poolId:msgid` | `Pool.msgid` set and not covered by another kind's trigger (catalogue in `shared/zfsMessages.ts`) | catalogue severity; unknown codes warning | transient | ack, accept, clear |
| `scrub-paused` (new, part C) | pool / `poolId` | `SCRUB` `SCANNING` with `scrub_pause` ≠ 0 for > 24 h | warning | transient | ack, accept, clear |
| `scan-stalled` (new, part C) | pool / `poolId` | `SCANNING`, not paused, no change in `examined` / `issued` for ≥ 6 h | warning; error for a resilver (redundancy at risk) | transient | ack, clear |
| `vdev-unredundant` (new, part C) | pool / `poolId:vdevGuid` | a `special` or `dedup` top-level vdev that is a single device | warning | transient | ack, accept ("intended"), clear |

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
  fault (`data.acknowledgedCounts`) since `FaultAcceptance` is SMART-keyed. Counters
  reset on reboot and import, indistinguishable from `zpool clear`, so a rise is any
  increase over the previous reading, summed into `data.total`; a drop is a new
  baseline. The acknowledged level is `data.total` at the click; a quiet row reopens
  when `data.total` passes it. Severity amber: a leaf ZFS has failed folds into
  `pool-degraded`, which carries the red.
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

## As built

Part A (ingest, data, topology):

- Fixtures `zpool-status-spare-avail.json`, `-spare-offline.json`, `-spare-inuse.json`
  (file-backed `tspare` on mars: mirror, log, l2cache, one spare).
- Under `--json-flat-vdevs`, log, cache and spare devices are top-level flat entries
  with no `parent`, told apart by `class` (`log`, `l2cache`, `spare`). A single log or
  cache device is the leaf itself, not a group. Before this task a single log parsed as
  type `log` (so never linked to its disk) and `l2cache` was unmapped (parsed as a plain
  leaf under root).
- Leaves keep their own type (`disk` / `file`); the class goes in `Vdev.role`
  (`normal`, `log`, `cache`, `special`, `dedup`, `spare`), inherited from the parent
  when a leaf has no `class` (`-L`). Top-level groups (`mirror-4` class `special`) keep
  the class as their type, as before. The topology card groups single devices by role.
- A spare's flat entry is its aux status: `AVAIL` with no error counters (parsed as 0),
  or `INUSE` with `"aux": "SPARED"`. While in use the flat map holds only that aux entry
  under the shared name key; the in-pool copy (`ONLINE`, parent `spare-N`) survives only
  in the nested `vdevs` maps. The parser takes the nested copy for position, state and
  counters, and keeps the aux state in `Vdev.spareState`, so one row per guid: the spare
  sits under `spare-N` while `INUSE` and back under root when `AVAIL`.
- Second migration `vdev_role_spare_state` (`Vdev.role`, `Vdev.spareState`, role
  backfilled from group type); `pool_scrub_config_removal` has the Pool columns only.
  The `scan-errors` → `pool-data-errors` rename is left for the kinds step.
- `Pool.lastScrub.endAt` is an ISO string; `repairedBytes` is null when the scan has no
  `processed`. Pool summaries carry `resolvedConfig` beside the raw `config`.
- First sighting writes the finished-scan entry, and also `leaf-errors-changed` /
  `pool-data-errors-changed` from 0 when a new leaf or pool already has errors, so
  backfill has a trail.
- `scrub-cancelled` fires for any scan function reaching `CANCELED` (keyed on start
  time). Icons: `scrub-cancelled` scan-line, `leaf-errors-changed` hard-drive,
  `pool-data-errors-changed` file-warning (037 updated).
- The simulator models spares as a separate `spares` section, unlike real output; align
  it with the flat-map shape in the simulator step.

Part B (kinds, folding, backfill, alerts, config API):

- Pool detectors live in `server/services/poolFaults.ts`. `detectFaults` returns
  `{ detections, superseded }`: a supersession names a subject, kinds and optional key,
  and a live row it matches resolves with diary `fault-resolved.data.supersededBy`
  (`{ kind, key }`). Order: `collector-silent` hosts → pools (missing, degraded) →
  leaves and `disk-missing`.
- `pool-degraded` lists failed leaves only (any role). A spare is healthy at `AVAIL`
  (aux) or `ONLINE` (in use), so `INUSE` spares are not listed (review decision;
  overrides the "spare in use: … `INUSE` spare listed" simulator row). Reopens a quiet
  row on severity rise, a new listed leaf, or a counter rise on a listed leaf.
- `pool-missing` is not raised for a host that is `collector-silent` or offline
  intermittent; pools of a silent host raise nothing and live pool faults resolve as
  superseded by `collector-silent`. Missing pools also resolve `pool-data-errors` and
  `scrub-overdue` (plainly, no supersession: no current data).
- `leaf-errors` covers group vdevs too (`data.role: "group"`, red) and the topology
  now writes `leaf-errors-changed` for groups (data gains `role`). Lifetime
  `until-resolved`; new action `resolve` (`POST /api/faults/:id/resolve`, a "Resolve"
  button in `FaultActions`), offered on `leaf-errors` only. After a hand resolution a
  new occurrence opens only on a rise since then. Data: `read`, `write`, `checksum`
  (current), `total` (summed rises), `rise24h`, `acknowledgedCounts` while quiet.
- `leaf-slow` uses the same summed-rise rule for `slowIos` over 24 h, on leaves not
  listed by `pool-degraded`.
- `pool-data-errors` data `{ poolName, dataErrors, scanErrors, function, finishedAt }`;
  latest finished scan from the diary as before. Reopens a quiet row on a data-error
  rise or a new scan with errors. No accept (as the table).
- `scrub-overdue` takes the newest of `Pool.lastScrub.endAt`, the latest
  `scrub-finished` entry and a finished `SCRUB` in `Pool.scan`. Time-windowed
  detectors judge as of `min(now, host's latest zpool-status)`.
- Migration `0017_fault_kind_pool_data_errors` (custom SQL): renames `Fault.kind`
  (data gains `scanErrors` from `errors`, `dataErrors` 0), `fault-*` diary
  `data.kind` and `Notification.rule`.
- Backfill: `vdev-state-changed` (vdev subject) drives `pool-degraded` leaves with
  `pool-state-changed`; `leaf-errors-changed` → `leaf-errors` (summed rises), resolved
  by `vdev-left` or a replayed hand resolution; `pool-data-errors-changed` and scan
  entries → `pool-data-errors`. A clean scan resets the replayed data-error count (the
  only trail of it clearing); the final sync reopens from `Pool.errors` if not.
  `fault-opened` replays seed gap kinds with their kind's severity.
- Alerts: new severity `notice` (Pushover priority -1) for `leaf-slow`.
  `pool-missing`, `scrub-overdue` and `leaf-slow` alert from their `fault-opened`
  entry. `vdev-state-changed` data gains `role` and `poolState`; the `pool-degraded`
  rule fires on a vdev entering a state other than `ONLINE` / `AVAIL` while
  `poolState` is `ONLINE`, on the pool subject. Entries from before this carry no
  `poolState` and never alert. `pool-data-errors` fires on any `*-finished` with
  errors (now `scan-finished` too) and on `pool-data-errors-changed`.
- `PATCH /api/pools/:id/config` merges the body into `Pool.config` and returns the
  pool detail; it queues `alerts:tick` so faults resync.
- Demo: seed now has `leaf-errors` open on tank's A7, a resolved `leaf-errors` on
  vault's V2 (superseded by `pool-degraded`) and past `scrub-overdue` occurrences;
  `seed.test.ts` counts updated. The planned seed story (ack at 12) is left for step 9.

Part C (review fixes, four more kinds; approved 2026-10-02):

- `zfsStateColour` maps a spare's `AVAIL` and `INUSE` to success (was the amber
  fallback); 037 updated.
- Migration `0018_vdev_role_backfill` (data only): leaves under a group whose role is
  not `normal` / `spare` take its role (recursive, present or not); leaves typed `log` /
  `cache` by the old parser (no children) get role from type and type `disk` when
  `path` is under `/dev/`, `file` for any other path, unchanged when `path` is null.
  Present rows were already corrected by the next ingest; this fixes departed ones. Old
  `l2cache` leaves parsed as plain leaves under root cannot be told apart and stay
  `normal` until seen again.
- dRAID: `vdev_type` `draid` parses as `draid1` / `draid2` / `draid3` from the name
  (`draid2:4d:12c:1s-0`), `draid1` when `-g` loses it, like raidz. Distributed spares
  (`vdev_type` `dspare`, ZFS's own word; `dist-spare` accepted too) parse as type
  `dspare`, a leaf (`LEAF_VDEV_TYPES` in `shared/zfsState.ts`, now the one leaf set
  for parser, topology and detectors) with role `spare`. Icons: layers / life-buoy.
  Tested with synthetic JSON only; no captured fixture.
- Shared spares (known limitation): `Vdev.guid` is unique, so a spare listed by two
  pools is one row. The first pool to list it in an ingest keeps it; later pools in
  the same ingest skip that row (no flip of `poolId`, no `vdev-left`). The second pool
  never shows the shared spare, and if the spare goes `INUSE` there, its `spare-N`
  group is missing that child.
- Parser keeps `scan.issued` and `scan.pausedAt` (`scrub_pause` epoch seconds, only
  when non-zero). New `Pool.scanProgressAt` (migration `0019_pool_scan_progress`): the
  ingest time a `SCANNING` scan last changed `examined`, `issued`, `pausedAt`, function
  or start; null when not scanning. A paused scan is never `scan-stalled`, and a
  resume restarts the clock.
- `pool-status` catalogue (`shared/zfsMessages.ts`, from the OpenZFS message list):
  `14` warning, `A5` error, `ER` warning, `EY` warning, `K4` error. Covered (raise
  nothing): `2Q`, `3C`, `4J`, `5E`, `6X`, `72`, `HC`, `JQ`, `MM` → `pool-degraded`;
  `8A` → `pool-data-errors`; `9P` → `leaf-errors`. Unknown codes warning with the
  first line of the status text as title. The feature-upgrade notice carries no
  `msgid`, so raises nothing. Data `{ poolName, msgid, title, status, action, moreinfo }`.
- `vdev-unredundant`: a leaf with role `special` or `dedup` whose parent is the root.
  Single log devices are not listed. Data as `leaf-errors` (`poolName`, `vdevGuid`,
  `name`, `role`, `diskId`).
- None of the four fold into another kind. All four are in `POOL_FAULT_KINDS`, so a
  silent host supersedes them; a missing pool resolves them plainly (not detected).
- Alerts from `fault-opened`: `pool-status` and `scan-stalled` alert, `scrub-paused`
  and `vdev-unredundant` notice. Mapping test updated.
- `fault-opened` diary data gains `severity`; backfill replays use it (else the kind's
  usual severity: all four new kinds default to warning). No other trail exists for the
  new kinds, so history before part C has none.

## Open questions

None. Decided 2026-10-02: `leaf-errors` resolves only by hand (or the vdev leaving the
pool), amber on leaves, red on groups, group counters included; `-j -v` carries `errlist` (key present on `tfault`), so parse it (array of paths as root, the string `"Permission denied"` otherwise); `pool-missing` warning; slow I/O default 10 per 24 h, tune once
mars has data; SMART faults stay separate from pool faults.
