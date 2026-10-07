---
type: task
status: done
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

Revised 2026-10-03 after the second review, which simulated this design on the prod
copy; expected results per replication are in Agent findings.

### Model

```
Replication       id, sourceDatasetId? (fk set null), targetDatasetId (fk cascade, unique),
                  direction (received|manual), manualIntervalSec?, lastSyncAt?,
                  archivedAt?, archivedNote (default ''), firstSeenAt, lastSeenAt
ReplicationSync   id, replicationId (fk cascade), at, snapshotName?, guid?,
                  snapshots (count of finish lines)
                  unique(replicationId, at); index(replicationId, at)
```

Receive history is the only evidence. Every receive into a pool is in that pool's
history, so GUID-only discovery (`inferred`) and `snapshot` evidence are cut: they had
no real instance. Interval and health are computed from `lastSyncAt` and the last 10
syncs; nothing else is stored.

### Sync derivation

A pure function over a host's receive history entries (`PoolHistory` rows):

- Finish line: `^finish receiving (\S+?)(?:/%recv)? \(\d+\) snap=(\S+)` (old
  format has no `/%recv`: `finish receiving zeta/p.clone (1949) snap=…`).
- Command line: `^zfs (?:receive|recv)\b.* (\S+)$`; its last argument is the target.
  `-d`/`-e`/`-R` receives name a parent: the command closes the pending cluster of
  every target equal to or under it.
- Order by `at`; at equal `at`, finish lines before command lines. Never rely on `id`
  (ingest order differs: `zfs-receives` backfill arrived after `zpool-history`).
- One run logs a finish line per snapshot (mars: ~30 per dataset in a minute) and one
  command line on completion. A sync is one run: the command line closes the target's
  pending finish lines into one sync, `at` = command time, `snapshotName` = last
  finish, `snapshots` = their count. A command with no pending finish lines is not a
  sync.
- Finish lines with no command (a tool that does not log one): a gap > 10 min starts
  a new cluster; a cluster becomes a sync (`at` = its last line) once that line is
  ≥ 15 min older than the payload's `receivedAt`.
- `guid` = the target's `Snapshot.guid` for `snapshotName` when known, else null;
  filled in later when snapshots arrive.

Population: after `observeZpoolHistory` for `zfs-receives` and `zpool-history`,
re-derive syncs for the host from its receive rows over a trailing 48 h window and
upsert on `(replicationId, at)` (idempotent). Backfill over all existing `PoolHistory`
once at boot, following `server/services/faultsBackfill.ts`. Prune syncs > 400 d.
Update `Replication.lastSyncAt`, `lastSeenAt`.

### Discovery and source

- A sync for a `<target>` naming a present dataset of the host, in a pool that is not
  archived ([047](047-Archive-pools.md)), creates its `Replication`
  (`direction = received`, diary `replication-discovered`). Targets with no present
  dataset are skipped (old one-off receives: `zeta/p.clone`).
- Source = a present dataset on another pool (same or other host) holding any GUID the
  target holds. Several candidates (chain: `zeta/q` → `tank/copies/zeta/q` and
  → `vpool/zeta/q`, with `syncoid_vault_…` snapshots flowing into both): prefer one that
  is not itself a target, then the one holding the newest common GUID, then the
  earliest `firstSeenAt`. Exclude datasets that are targets of a replication sourced
  from this target (a restore does not make a cycle).
- The source is decided once and stored; re-evaluated only while null (e.g. after
  each snapshot ingest), never cleared automatically. Cross-host common GUIDs come and
  go hourly (vault pairs share one snapshot; snapshot listings race the hourly sync),
  so live evaluation would flap. `PATCH` sets it by hand (`direction = manual`).
- Source null after evaluation: shown as "source not monitored". Old old hosts
  replicas on mars are not discovered at all (receives older than the history tail,
  no monitored source): accepted.

### Interval

Learnt = median gap between the last 10 syncs; needs ≥ 3 syncs, else `learning`.
`manualIntervalSec` overrides.

### Health

`referenceAt = min(now, last ok zfs-receives run of the target host)` (keyed per source
in `lastRuns`, `server/services/hosts.ts`). `dueAt = lastSyncAt + interval`,
`overdue = referenceAt − dueAt`. A silent target host freezes the status;
`collector-silent` covers it.

| status | colour | shape | when |
| --- | --- | --- | --- |
| `ok` | neutral | filled | not overdue past the late threshold |
| `late` | warning | filled | overdue > max(late floor, late factor × interval) |
| `stalled` | error | filled | overdue > max(stalled floor, stalled factor × interval) |
| `learning` | neutral | hollow | interval unknown |
| `target-gone` | error | filled | target dataset no longer present, its pool present and not archived |
| `source-gone` | neutral | hollow | stored source no longer present (target present) |
| `archived` | neutral | hollow | marked no longer replicated, or target pool archived |

Add these to [037](037-Status-and-icon-vocabulary.md).

Thresholds: keys in `settingsConfigSchema` / `settingsPatchSchema`
(`shared/schemas/settings.ts`; `getSettings` spreads the defaults), on the settings
page. Defaults: late floor 3 h, late factor 0.5, stalled floor 2 d, stalled factor 2.

### Archiving

"No longer replicated", optional note. Archived: row, syncs and ladder kept, no faults,
open faults resolved. A new sync after archiving un-archives it (diary
`replication-resumed`). Archiving a pool ([047](047-Archive-pools.md)) also resolves
replication faults of targets in it (`resolvePoolFaults` resolves only pool subjects).

### Faults, diary, alerts

- New subject type `replication` in `FAULT_SUBJECT_TYPES` and `DIARY_SUBJECT_TYPES`,
  and everywhere they are switched on: `DIARY_SUBJECT_ICON`
  (`app/utils/diarySubjects.ts`), `subjectLink` (`DiaryTimeline.vue`),
  `faultSubjectPath` (`app/utils/vocabulary/fault.ts`), `subjectLookup` /
  `describeSubject` (`server/services/faults.ts`). Check `switch` defaults by hand; TS
  will not flag them.
- Three kinds, category `zfs`, lifetime `transient`, one per replication:
  `replication-late` (warning), `replication-stalled` (error) and
  `replication-target-gone` (error); stalled supersedes late, target gone supersedes
  both (046 §Folding, `Supersession`). Target gone resolves when the dataset reappears
  (a later full receive recreates it) or the replication is archived. A source gone
  opens nothing. Escalation then writes its own diary entry and
  alert; a severity rise on one kind would not (`nextState`, `refreshFault`).
  Detected in `detectFaults`, reading one `Replication` row and its last 10 syncs each.
- Alerts: `ALERT_RULES` entries (`shared/alerts.ts`), a `matchReplicationEntry` for
  `fault-opened`, `describeSubject` + an `AlertContext.replication(id)` lookup, and the
  archived skip, in `server/services/alerts/rules.ts`. Nothing generic exists.
- Diary auto events: `replication-discovered`, `replication-archived`,
  `replication-resumed`. Late/stalled come from the fault entries.
- `NavigationCounts` (`shared/navigation.ts`) gains `replications` (late + stalled +
  target gone),
  plus its query and a sidebar item.

### API

- `GET /api/replications` → rows: id, source (host, pool, dataset)?, target (host,
  pool, dataset), direction, status, intervalSec, intervalManual, lastSyncAt, dueAt,
  overdueMs, syncCount, archivedAt.
- `GET /api/replications/:id` → row + syncs (newest first, paged 100) + ladder + diary
  + open faults. Ladder: both datasets' snapshots, newest first, joined by GUID into
  rows `{ source?, target?, guid, creation }`, capped at 200.
- `PATCH /api/replications/:id` → `sourceDatasetId` (sets `direction = manual`),
  `manualIntervalSec` (null clears), `archived` + `archivedNote`. Schema in
  `shared/schemas/replications.ts`.
- `GET /api/pools/:id/datasets` gains per dataset
  `replications: { id, role (source|target), status }[]`.

### Simulator and demo

- Simulator ([044](044-Fault-simulator.md)): a pool-level case "replication stalls"
  in `afterReplay`, like `backdateSighting` (`scenarios/presence.ts`): shift the
  pool's targets' `ReplicationSync.at` and `lastSyncAt` back by N hours. Absence of
  lines cannot be simulated through ingest (history dedupes).
- Demo: `finish receiving` lines gain `snap=` (`server/demo/zpoolHistory.ts`); the
  demo fleet gets at least one ok, one late and one stalled replication with matching
  GUIDs on both sides.

### Tests

Fixtures: hand-written history bodies from the prod lines in Agent findings (no vault
capture exists). Derivation: mars daily multi-snapshot runs, vault hourly, same-second
command/finish, old format, `-d` receive, command with no finishes, cluster without
command. Discovery: chain source choice, absent target, restore exclusion, source
stored not flapping. Health: per status, silent host. Faults: late → stalled
supersession, archive resolves. e2e for routes.

### Steps (one commit each)

1. Schema + migration, `shared/replications.ts` (statuses, types), settings keys.
2. Sync derivation + population + backfill + discovery/source.
3. Health, services, routes, pool datasets field, e2e.
4. Subject type plumbing, fault kinds, alerts, navigation count, pool-archive
   resolution, 037.
5. PATCH (archive, interval, source), simulator case, demo.

## Stage 3: UI

- **Replications page** `/replications`, sidebar entry with count
  ([048](048-Sidebar-status-counts.md)). Rows grouped visually by source host +
  parent → target host + parent (e.g. mars `tank/*` → vault `vpool/tank/*`); group
  header shows the worst member status. No stored groups. Columns: source, target,
  status dot, cadence ("hourly", "~daily"; marked when manual), last sync, next due.
  Archived in a collapsed section at the bottom.
- **Detail page** `/replications/:id`: header (source → target, status, direction),
  cadence panel with override, source override, "No longer replicated" action, sync
  log (time, snapshot, snapshots received, gap since previous; gaps over the interval
  highlighted), snapshot ladder, diary.
- **Pool page datasets tab** (`DatasetTree.vue`): replication column, one icon per
  replication (out for source, in for target) with status dot, linking to the detail
  page. Dataset page lists its replications too.
- Settings page: the four thresholds.

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
4. ~~Recursive replications are grouped under their root.~~ Superseded by 12.
5. ~~Old replicas show and fault by default.~~ Superseded by 13; archiving stays.
6. Staged: collector first, then server, then UI.
7. History collected with `TZ=UTC`.
8. Snapshots collected hourly, not more often: listing is slow on hosts.
9. `finish receiving` is reliable (vault: 10 063 for `vpool/zeta/q`); the gaps in the
   dev database were the collector's history tail.

10. No `zfs send` evidence: every current target is monitored and logs receives.
    Unmonitored targets are stubbed in
    [053](053-Replication-to-unmonitored-targets.md).
11. `replication` is the fault and diary subject (not the target dataset): faults link
    to the detail page, groups and chains stay clean.

12. Groups are visual only: nothing groups on real data (no root dataset is itself
    replicated). Faults per replication, no archive cascade.
13. Old replicas that cannot be discovered (old hosts) stay invisible.
14. Two fault kinds, late and stalled, stalled supersedes late.
15. Keep the snapshot ladder.
16. Target dataset gone is a fault (red); source gone stays neutral.

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

### Stage 1 deployed (prod copy 2026-10-03 21:32Z)

mars and vault on 0.4.0, migration 0023 applied, no failed runs.

- GUIDs: 0 saturated, 0 null across 1 853 snapshots.
- History: every row has a pool; timestamps UTC (vault `…22:00:32-GMT01:00` stored
  21:00:33Z).
- Receives reach back to 2026-09-13 on mars `tank`, 2026-09-29 on vault `vpool`. vault hits
  the 2 000-line tail (1 000 finish + 1 000 command lines, ~4.5 days); enough to learn
  an hourly cadence.
- **One run logs many `finish receiving` lines.** mars zeta → tank/copies sends
  every intermediate snapshot: ~30 `finish receiving` lines per dataset in one 05:00Z
  run, ~1 s apart, then one `zfs receive -s -F <target>` command line when the run
  completes. vault: one of each per hour. So for stage 2:
  - a sync = one `zfs receive|recv … <target>` command line (`at` = completion);
    its newest snapshot = the last `finish receiving <target>/%recv` at or before it.
    Fall back to clustering finish lines (gap > 10 min starts a new sync) when no
    command line is present (other tools may not log one, e.g. `zfs recv` via a
    library).
  - the interval median must be over syncs, never over finish lines.
- Old one-off receives exist (mars `zeta/p.clone`, `zeta/q/r.clone`,
  2025-08-11; datasets gone): discovery skips targets with no present dataset.
- tank/copies/zeta/* also receive vault's `syncoid_vault_…` snapshots (the chain
  case in Discovery): vault pulls from mars `zeta/*`, the snapshot travels on to
  tank/copies.

### Second review: design simulated on the prod copy (2026-10-03 21:32Z)

| Replication | syncs | interval | last sync | status |
| --- | --- | --- | --- | --- |
| mars zeta/{p,q,q/r} → tank/copies/zeta/* | 20–21 (~650 finish lines each) | 24 h | 05:00–05:01Z | ok |
| mars tank/{a,b,c,c/d,e,f/g} → vault vpool/tank/* | 111 each | 1 h | 21:00Z | ok |
| mars zeta/{p,q,q/r} → vault vpool/zeta/* | 111–112 | 1 h | 21:00Z | ok |
| zeta/p.clone, zeta/q/r.clone (2025-08) | skipped, target absent | | | |
| tank/copies/oldhost/* | not discovered | | | |

Chain: "prefer a non-target" picks `zeta/*` as source for both tank/copies and vpool.
19 same-second command/finish pairs have the command at the lower id; ordering by id
creates a phantom empty sync. vault pairs share exactly one GUID, so the common
snapshot vanishes for an hour roughly one hour in four. Collected history covers
20 days on mars `tank`, 4.5 days on vault `vpool`. No `PoolHistory` pruning exists.
The alerts pass runs after every ingest (~100/h), so health must read stored rows.

### Stage 2 (server)

Done 2026-10-03; real-data check on the prod copy matches the second review table
(all 12 discovered, chain sources `zeta/*`, 20–21 daily and 111–112 hourly syncs, all
`ok` as of the copy's last history run).

For stage 3:

- `shared/replications.ts`: `REPLICATION_STATUSES` (`ok`, `late`, `stalled`,
  `learning`, `gone`, `archived`), `REPLICATION_DIRECTIONS` (`received`, `manual`),
  `REPLICATION_ROLES`, the row types (`ReplicationRow`, `ReplicationEndpoint`,
  `ReplicationSyncView`, `ReplicationLadderRow`, `DatasetReplication`),
  `replicationLabel` ("source → target"), `REPLICATION_SYNCS_PAGE` (100),
  `REPLICATION_LADDER_LIMIT` (200). Health is `replicationHealth` there too.
- `GET /api/replications` → `ReplicationRow[]`, sorted by target host then target
  dataset; no grouping. `source` is null while not monitored. `intervalSec` null while
  learning; `dueAt`, `overdueMs` null with it. Dates are ISO strings.
- `GET /api/replications/:id?page=N` → `ReplicationDetail`
  (`server/services/replications/detail.ts`): the row plus
  `syncs: { items, total, page, pageSize }` (newest first, 1-based pages), `ladder`,
  `diary` (`DiaryEntryRow[]`), `faults` (live `FaultView[]`).
- `PATCH /api/replications/:id` (`replicationPatchSchema`,
  `shared/schemas/replications.ts`) → `ReplicationDetail`. `sourceDatasetId`: a dataset
  sets it and `direction = manual`; null hands it back to discovery
  (`direction = received`, re-evaluated at once). `manualIntervalSec` 60 s–366 d, null
  clears. `archived: true` with optional `archivedNote` (the note only with
  `archived: true`); `archived: false` un-archives.
- `GET /api/pools/:id/datasets`: each dataset has
  `replications: { id, role, status }[]`.
- Settings keys (no UI yet): `replicationLateFloorHours` 3, `replicationLateFactor`
  0.5, `replicationStalledFloorHours` 48, `replicationStalledFactor` 2, all in
  `settingsPatchSchema`.
- Sidebar entry Replications (`i-lucide-arrow-right-left`, badge `replications`)
  links to `/replications`, which does not exist yet. Diary and fault links go to
  `/replications/:id`. No `app/utils/vocabulary` file for statuses yet; 037 has the
  table.

Decisions and deviations:

- Derivation (`server/services/replications/derive.ts`): a command closes its own
  target's pending finish lines; it closes those under it only when it has none of its
  own or carries `-d`/`-e`. Otherwise a child's run logged in the same second as its
  parent's command would be swallowed by the parent.
- Re-derivation after a history payload starts 48 h before the payload's oldest
  receive line, not 48 h before now, so a host's first `zfs-receives` backfill (weeks)
  is taken whole even after the boot backfill has run.
- Upserted syncs keep the larger `snapshots` count, so a run cut by the window edge
  does not shrink.
- Source choice adds a tie-break after newest common snapshot: most snapshots in
  common. Without it, a chain member discovered before its sibling is a target can win
  the tie on the one shared sync snapshot. Unresolved sources are decided oldest
  replication first, so a later restore is told apart.
- `unique(replicationId, at)` serves as the index; no second index.
- `replicationsBackfilledAt` setting; `replications:backfill` task queued at boot
  before `faults:backfill`, one after the other (concurrent `createTask` calls could
  take the same id).
- The diary subject plumbing landed with step 2 (discovery writes diary entries); the
  fault side with step 4.
- Late/stalled detections carry stable data (`targetName`, `sourceName`, `hostName`,
  `lastSyncAt`, `intervalSec`) so the alerts pass does not rewrite them each tick.
  Archived replications withdraw their faults (reason `archived`). A silent target host
  freezes status; replication faults are not superseded by `collector-silent`.
- `resolvePoolFaults` also resolves replication faults of targets in the pool.
- `referenceAt` uses the last ok run of `zfs-receives` or `zpool-history`, so a host
  on a pre-0.4.0 collector still has one.
- Navigation `replications`: stalled red, late amber, ok/learning/gone neutral,
  archived out.
- A new sync after archiving un-archives (`replication-resumed`); un-archiving by
  PATCH writes the same event.
- Simulator "Replication stalls" (pool, group Replication) moves every sync into the
  pool back by N hours (default 96); the next real history ingest moves them back.
- Demo: receives log `snap=` with the newest snapshot received; replicas of
  `tank/media/music` and `tank/backups/laptops` run 2 and 4 days behind the daily
  schedule, so they stay late and stalled at any demo time.

Unverified: behaviour against a tool that logs no command line (only hand-written
tests); `-e` receives; the live ingest path on prod (only the backfill was run on
the copy).

### Stage 3 (UI)

Done 2026-10-04.

- Vocabulary: `app/utils/vocabulary/replication.ts`. Status colour, shape, label and a
  rank for "worst" (stalled, late, gone, learning, ok, archived); role icons
  `i-lucide-upload` (source) and `i-lucide-download` (target); direction labels
  "Discovered" / "Source set by hand". `formatCadence`: a learnt interval within 2 % of
  an hour, day or week takes the word, within 15 % the word with `~`, else
  `every N min|h|d` (`~` when rounded). A manual interval is named only when exact
  and carries a pencil (`ReplicationCadence`). 037 updated.
- Components in `app/components/replication/` (auto-imported as `Replication*`; the
  dev server may need a restart to pick up the new directory).
- `/replications`: one table per group under a heading (dot of the worst status,
  `host parent/* → host parent/*`, count); groups in API order (target host, then
  dataset). Archived = status `archived` (marked or target pool archived), collapsed
  under a toggle, not remembered. Data refreshes on the 60 s clock tick, no SSE.
- `/replications/:id`: header (host and dataset links either side of an arrow icon),
  archived banner, open faults (`useFaults` on `replication:<id>`, like the pool
  page, rather than the detail's `faults`, so actions work), cadence, source and
  target panels, then tabs Syncs / Snapshots / Diary as on the pool page. Actions
  menu holds "No longer replicated…" (modal with note) or "Unarchive".
- Source and target panels share `ReplicationEndpointFacts` over the detail's
  `ends`: pool state badge, referenced, snapshot count with space used by
  snapshots, newest snapshot and age, available, compression and ratio,
  encryption (`off` when unset) with "key loaded" / "key not loaded" from
  `keystatus` (collector 0.8.0 adds `keystatus,encryptionroot` to zfs list; older
  collectors leave both null and nothing shows), recordsize, mountpoint when set,
  created. Read side by side the two answer "is the target caught up, encrypted,
  and will the next send fit"; a loaded key on an off-site target is worth a look.
- Interval override is entered in hours (decimals allowed); blank or "Use learnt"
  sends `null`.
- Source override: dataset search (`useDatasetSearch`, as the diary form) excluding
  the target; "Rediscover" (manual only) sends `sourceDatasetId: null`.
- Sync log gaps: marked `late`/`stalled` (warning/error text) when the gap past the
  interval exceeds the configured thresholds, i.e. the status the replication would
  have had. Deviation from "gaps over the interval highlighted": a strict
  `gap > interval` would mark about half of all gaps, since the interval is their
  median. The oldest row on a page shows no gap (its predecessor is on the next page).
- Ladder: 50 rows at a time ("Show more"), arrow between the sides when both hold the
  snapshot (guid in the tooltip); source column hidden while not monitored.
- `GET /api/datasets/:id` gains `replications: ReplicationRow[]`
  (`replicationsOfDataset`); the dataset page shows them grouped, only when any exist.
- Pool datasets tab: Replication column, one link per replication (role icon + dot,
  title "Sends · Late").
- Settings: Replication section on General settings, the four thresholds saved
  together, with a worked example in the copy.

Check in a browser (needs `pnpm db:migrate` and a server restart on the dev copy so
the backfill runs; or the demo):

- Sidebar Replications count and link; `/replications` groups, headings' worst dot,
  long dataset names truncating, table width at phone width (tables scroll).
- A late and a stalled demo replication: amber/red status and "overdue" text.
- Archived section toggle; archive from the detail menu with a note, banner, then
  Unarchive.
- Detail page: cadence panel, set 24 h then "Use learnt"; choose a source by search,
  then Rediscover; sync log pagination with > 100 syncs and marked gaps after the
  "Replication stalls" simulator case; Snapshots tab arrows; Diary tab entries.
- Pool datasets tab icons and dots link to the right replication; dataset page
  Replications section on a source and on a target.
- Settings: thresholds show the defaults, save, and change a status on reload.

### Simulator on the replication page

Done 2026-10-04. Replication is a simulator subject (044 §Replication): Running late,
Stalled (defaults just past each threshold), Target / Source dataset destroyed
(`gone`). The pool-level "Replication stalls" stays.

### Target gone is a fault (decision 16)

Done 2026-10-04. Status `gone` split: `target-gone` (error, filled, rank above
stalled, nav red) opens `replication-target-gone` (alert, superseding late and
stalled); `source-gone` (neutral, hollow, where `gone` ranked) opens nothing. Both
gone reads `target-gone`. Status is computed on read, so no migration.

- `replicationHealth` takes `targetGone` and `sourceGone` in place of `gone`.
- A dataset in a missing pool is not target gone: ingest only marks datasets absent
  for pools in the `zfs list`, so a missing pool's replications stay measured (late,
  stalled) beside `pool-missing`, as before. Presence via `poolPresence`.
- Fault title "Replication target … no longer exists".
