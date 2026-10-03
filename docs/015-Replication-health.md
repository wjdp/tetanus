---
type: task
status: in-progress
---

# Replication health

Know what is replicated where, how often it is expected to happen, and fault when it
stops. tetanus observes replication; it does not drive it and is agnostic to the tool
(sanoid/syncoid, zrepl, znapzend, a cron'd `zfs send`). Extends Phase 9
([029](029-Phase-9-ZFS-datasets-and-snapshots.md)); design context in
[003](003-Architecture-and-data-model.md). Rewritten 2026-10-03 after digging through
the dev database and a review; the original GUID pairing idea stands, the rest is new.

Three stages. Stage 1 is collector-only and ships first so history and exact GUIDs
accumulate while stages 2–3 are built.

## Why

A backup is only as good as its last receive. Nothing tells the author that
`tank/a` stopped arriving on vault three weeks ago.

## Scenarios

1. **Same host, pool to pool.** mars `zeta/{p,q,q/r}` →
   mars `tank/copies/zeta/…`. Sanoid autosnaps replicated as-is (syncoid
   `--no-sync-snap` or similar), daily around 06:00.
2. **Cross host.** mars `tank/*`, `zeta/*` → vault `vpool/tank/*`, `vpool/zeta/*`. syncoid
   pull run on vault (`syncoid_vault_…` sync snapshots), hourly. Target keeps only the
   latest sync snapshot. No root replication (`vpool/tank` has no snapshots), so these
   do not group.
3. **Source not monitored.** mars `tank/copies/oldhost/root/*` from old hosts; only the
   target is visible. Newest snapshot 2025-12-29: old replicas, to be archived.

## Findings

1. **GUID bug, blocks everything.** 955 of 1 895 `Snapshot.guid` rows (mars 952,
   vault 3) are `9223372036854775807` (INT64_MAX); the raw fixture has it too
   (`test/fixtures/mars/zfs-snapshots.json`). `zfs list -j --json-int` saturates u64
   GUIDs ≥ 2^63. Verified on mars: without `--json-int`, `zfs list -j -p` gives the
   exact GUID as a string (`"guid":{"value":"18101820395123456789"}`).
2. **Pairing by shared GUID works** once INT64_MAX is excluded: 31 real shared GUIDs,
   6 vault + 3 mars-local pairs today; the rest wait on the fix.
3. **Snapshot `creation` is preserved by send/recv**, identical on both sides: no use
   for direction. `Dataset.creation` is not reliable either (mars `tank/c` was itself
   received in 2026-07, a restore).
4. **Every receive is in the target pool's history** as an internal line
   `finish receiving vpool/zeta/q/r/%recv (52698) snap=syncoid_vault_2026-10-02:23:00:20-GMT01:00`,
   plus the `zfs receive -s -F vpool/zeta/q` command. vault has 10 063 for
   `vpool/zeta/q` alone. Target dataset + snapshot name → GUID → source dataset.
5. **The collector loses almost all history.** `collect_zpool_history`
   (`host/tetanus-collect`) runs `zpool history -il | tail -n 500` over all pools:
   - The tail is only the last pool's tail (mars: 11 570 of 11 576 rows are `zeta/`,
     none `tank/`), and on vault only the most recent datasets' receives.
   - The tail cuts the `History for '<pool>':` header, so `observeZpoolHistory`
     (`server/services/zfs/history.ts`) never resolves a pool: all 13 345
     `PoolHistory` rows have `poolId IS NULL`.
6. **History times are local time stored as UTC** (`isoFromLocalTimestamp`,
   `server/ingest/zpool-history.ts`). vault rows are 1 h ahead; DST shifts every gap.
7. **Snapshots alone cannot give cadence.** Collected every 6 h, and a syncoid target
   keeps one snapshot, so 5 of 6 hourly sync snapshots are never seen. In scenario 1
   the target holds sanoid's 15-minute snapshots, so their creation gaps say 15 min,
   not daily. Receive history is the primary signal; GUIDs are the pairing key.

## Stage 1: collector

Deploy before the server work. Bump `COLLECTOR_VERSION` (`shared/collector.ts`);
`MIN_COLLECTOR_VERSION` unchanged.

- **`zfs-snapshots`**: drop `--json-int`. `toNumber` already accepts decimal strings.
  Keep the guid pre-parse regex (`server/ingest/zfs-snapshots.ts`): collectors still on
  the old version send numeric GUIDs that lose precision above 2^53 without it. Parser
  maps an INT64_MAX guid to `null`. Migration sets existing INT64_MAX rows to `null`
  (the next ingest refills them).
- **Snapshot cadence**: `tetanus-collect-snapshots.timer` 6 h → hourly. Update 001's
  cadence table, 003, `host/README.md`.
- **`zpool-history` per pool**: loop `zpool list -H -o name`; per pool print
  `History for '<pool>':` then `TZ=UTC zpool history -il "$pool" | tail -n 500`.
  Parser unchanged (UTC timestamps parse as UTC).
- **`zfs-receives`** (new source, `zfs` group, 10 min): same per-pool loop with header,
  `TZ=UTC zpool history -il "$pool" | grep -E 'finish receiving|zfs (recv|receive) ' | tail -n 2000`.
  Parsed by the `zpool-history` parser and stored through `observeZpoolHistory`; dedupe
  on the existing `(hostId, at, text)` key makes overlap with `zpool-history` free.
  Worth having despite the per-pool fix: the first run backfills months of receives, so
  cadence is known on day one, and sanoid's destroy churn cannot push receives out.
- **Existing `PoolHistory` rows**: delete those with `poolId IS NULL` in a migration
  (unattributed and time-skewed; corrected copies would otherwise sit next to them).
  Check first that nothing else reads them.
- `host/install.sh` checks `grep` alongside `curl`. `bin/capture-fixtures.sh` and
  `host/test/stub.sh` follow the new commands; user re-captures mars and vault
  fixtures (`zfs-snapshots`, `zpool-history`, `zfs-receives`).

Tests: parser guard (INT64_MAX → null, string and numeric guids), per-pool history
fixture resolves `poolId`, `zfs-receives` fixture parses.

## Stage 2: server

### Model

```
Replication       id, sourceDatasetId? (fk set null), targetDatasetId (fk cascade, unique),
                  direction (received|inferred|manual|unknown), manualIntervalSec?,
                  archivedAt?, archivedNote?, firstSeenAt, lastSeenAt
ReplicationSync   id, replicationId (fk cascade), at, snapshotName, guid?,
                  evidence (receive|snapshot)   unique(replicationId, snapshotName)
```

Computed on read, not stored: learnt interval, group membership, health.

### Discovery and direction

- A `finish receiving <target>/%recv … snap=<name>` row creates or updates the
  replication for `<target>`; `direction = received`.
- A GUID shared by datasets on different pools (or hosts) with no receive evidence
  creates one with `direction = inferred`: the side whose newest snapshot is newer than
  the latest common one is the source; neither → `unknown`.
- Source choice when a GUID is on more than two datasets (chain
  `zeta/q/r` → `tank/copies/zeta/q/r` and → `vpool/zeta/q/r`):
  prefer a candidate that is not itself a target, then the one holding the newest
  common GUID, then the earliest `firstSeenAt`. Manual override wins.
- Source null when no other monitored dataset holds the GUID (scenario 3).
- A receive in the opposite direction on an existing pair (a restore) does not flip
  it; diary note on the replication, user can override.
- Datasets with `present = false` or in archived pools
  ([047](047-Archive-pools.md)) take no part in discovery; an existing replication
  whose side goes `present = false` is `gone`.

### Sync log

- One `ReplicationSync` per `finish receiving` row (`at` = history time, now UTC).
- Without receive evidence for the replication, one per newly seen common GUID
  (`at` = ingest time; granularity = snapshot cadence).
- Prune > 400 d.

### Interval

Learnt = median gap of the last 10 syncs of one evidence kind: `receive` when it has
≥ 3, else `snapshot` with ≥ 3, else unknown (`learning`). Never mix kinds.
`manualIntervalSec` overrides.

### Groups

A replication whose source and target are children of another replication's source and
target with the same relative path belongs to the topmost such replication's group.
Renamed children do not group (accepted). Group status = worst member.

### Health

`referenceAt = min(now, last ok zfs run of the target host, last ok zfs run of the
source host when monitored)` (pattern: `diskSightingTimes`, `server/services/hosts.ts`).
`dueAt = lastSyncAt + interval`, `overdue = referenceAt − dueAt`. A silent host freezes
the status; `collector-silent` covers it.

| status | colour | shape | when |
| --- | --- | --- | --- |
| `ok` | neutral | filled | not overdue |
| `late` | warning | filled | overdue > max(late floor, late factor × interval) |
| `stalled` | error | filled | overdue > max(stalled floor, stalled factor × interval) |
| `learning` | neutral | hollow | interval unknown |
| `gone` | neutral | hollow | a side is no longer present |
| `archived` | neutral | hollow | marked no longer replicated |

Add these to [037](037-Status-and-icon-vocabulary.md).

Thresholds: keys in `settingsConfigSchema` / `settingsPatchSchema`
(`shared/schemas/settings.ts`), shown on the settings page. Defaults: late floor 3 h,
late factor 0.5, stalled floor 2 d, stalled factor 2.

### Archiving

Old replicas fault until the user archives them ("No longer replicated", optional
note). Archived: row, sync log and ladder kept, no faults, open fault resolved. A sync
after archiving un-archives it. Archiving a group root archives its members.

### Faults and diary

- `FAULT_SUBJECT_TYPES` and `DIARY_SUBJECT_TYPES` gain `replication`; label and link
  in `app/utils/diarySubjects.ts` and the faults page.
- Kind `replication-overdue`: category `zfs`, lifetime `transient`, `warning` for
  `late`, `error` for `stalled` (severity rise handled by `isSeverityRise`), one per
  group root. Detected in `detectFaults` (`server/services/faults.ts`), which runs in
  the alerts pass. Alerts ride the existing fault → notification path.
- Diary auto events on the replication: `replication-discovered`,
  `replication-archived`, `replication-resumed`, `replication-reversed`. Late and
  stalled come from the fault diary entries (`writeFaultEvent`); no duplicates.
- `StatusCounts` (`shared/navigation.ts`) gains `replications`.

### API

- `GET /api/replications` → rows: source (host, pool, dataset)?, target, direction,
  status, interval (and whether manual), lastSyncAt, dueAt, overdue, group root id.
- `GET /api/replications/:id` → row + group members or root + sync log (newest first,
  paged) + common snapshot ladder + diary + faults.
- `PATCH /api/replications/:id` → source/direction override, `manualIntervalSec`,
  `archived` + `archivedNote`. Schema in `shared/schemas/replications.ts`.
- `GET /api/pools/:id/datasets` gains per dataset
  `replications: { id, role (source|target), status }[]`.

### Simulator and demo

- Simulator ([044](044-Fault-simulator.md)): subjects are disk/pool/host. Add a
  pool-level "replication stalls" case that stops emitting receive lines for the
  pool's targets.
- Demo seed: `server/demo/zfs.ts` renders `zfs-snapshots` and `zpool-history`; teach
  it shared GUIDs and receive lines for scenarios 1–3, one late, one stalled, one
  archived, one recursive group.

Tests: service against fixtures for scenarios 1–3 (pairing, chain source choice,
restore reversal, interval per evidence kind, groups, silent host, archive/un-archive);
fault detection; e2e for the routes.

## Stage 3: UI

- **Replication page** `/replications`, sidebar entry with count
  ([048](048-Sidebar-status-counts.md)). Sections by source host → target host;
  one row per group root, expandable to members. Columns: source, target, members,
  status dot, cadence ("hourly", "~daily"; marked when manual), last sync, next due.
  Archived in a collapsed section at the bottom.
- **Detail page** `/replications/:id`: header (source → target, status, direction
  badge saying how it was known), group members or link to root, cadence panel with
  override, "No longer replicated" action, sync log (time, snapshot, gap since
  previous, evidence; gaps over the interval highlighted), common snapshot ladder,
  diary.
- **Pool page datasets tab** (`DatasetTree.vue`): replication column, one icon per
  replication (out for source, in for target) with status dot, linking to the detail
  page. Dataset page lists its replications too.

## Out of scope

- Driving replication. Read-only.
- Divergence, interrupted receives (`receive_resume_token`), target writable, key
  status: follow-up (needs a `zfs get` source).
- Per-replication thresholds.
- Bookmarks, off-host targets tetanus cannot see, non-ZFS job reports.

## Decisions (2026-10-03)

1. Thresholds as above, global settings; per-replication later if needed.
2. Exact GUID via `zfs list -j -p` without `--json-int`, verified on mars.
3. `grep` in the collector is fine; the installer checks for it.
4. Recursive replications are grouped under their root; renamed children do not group.
5. Old replicas show and fault by default; the user archives them.
6. Staged: collector first, then server, then UI.
7. History collected with `TZ=UTC`.
8. Snapshots collected hourly, not more often: listing is slow on hosts.
9. `finish receiving` is reliable (vault: 10 063 for `vpool/zeta/q`); the gaps in the
   dev database were the collector's history tail.

## Unanswered questions

1. `zfs send` lines as a third evidence kind (see chat 2026-10-03)?
2. `replication` as fault and diary subject, or the target `dataset`?

## Agent findings

(agents append here)

### Stage 1 (collector 0.4.0)

Done 2026-10-03, not yet deployed.

- `host/tetanus-collect`: `history_per_pool` builds both history sources; a host with
  no pools skips them. `receive_lines` is the grep. Snapshots without `--json-int`.
- `zfs-receives` parser (`server/ingest/zfs-receives.ts`) is the `zpool-history` parser
  with empty bodies allowed; handler is `observeZpoolHistory`.
- `zfs-snapshots` parser maps the saturated guid, numeric or string, to `null`; the
  pre-parse regex stays for old collectors.
- Migration `0023_guid_saturation_and_unattributed_history`.
- Snapshots cadence in `shared/hostFreshness.ts` is 1 h; `DEMO_CADENCES` keeps 6 h.
- Demo renders per-pool history and `zfs-receives` (14-day window of its existing
  receive lines); the seed trimmer dedupes each history source separately.
- `host/test/stub.sh` maps the new `zpool list -H -o name`, per-pool history and
  snapshot argv to the old mars fixtures until the user re-captures with
  `bin/capture-fixtures.sh`, which now captures `zpool-names`,
  `zpool-history/<pool>` and `zfs-receives/<pool>`; `bin/replay-fixtures.sh` handles
  both layouts. Drop the stub mappings and update the zpool-history parser test (its
  "every entry's pool is null" note) after the re-capture.
- `shellcheck` not run (not installed).
