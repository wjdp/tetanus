---
type: task
status: done
---

# Faults page

One place to find every fault in the system — disk, host and ZFS — whether it is live,
acknowledged, accepted or over, with filters. The default view is what needs attention
now. A count badge on the nav entry makes it visible from anywhere.

Grew out of the fault banners ([035](035-Collector-version-tracking.md) §Fault,
[004](004-Project-plan.md) Phase 8 step 4): today the strip at the top of every page
shows only collector faults, dismissals live in one browser's `localStorage`, and a
dismissed fault is gone with no way to see it again. Revised 2026-10-02 after
[042](042-Acknowledge-faults.md): faults are records with a lifecycle, not a derived
"what's wrong now" list, and "dismiss" becomes acknowledge / accept.

## Model

A fault is an **occurrence**: a condition that started at a time, may be acknowledged
or accepted, and may end. Same shape as Alertmanager / PagerDuty incidents
(triggered → acknowledged → resolved). Stored, so ended faults stay findable; derived
state alone cannot show history.

Distinct from alerts (sends, in `Notification`) and the diary (narrative). The diary
still gets entries for open, acknowledge, accept and resolve (§Sync).

### States

| state | meaning | default view | counts towards status / badge |
| --- | --- | --- | --- |
| `open` | live, nobody has looked | yes | yes |
| `acknowledged` | live, seen, being watched | yes | as `warning` (amber), never the badge |
| `accepted` | live, judged fine | no | no |
| `resolved` | condition has gone | no | no |

### Two kinds of lifetime

Kinds differ in whether the condition clears by itself, which decides what an
acknowledgement is attached to:

- **Transient** (host silent, disk missing, pool degraded, collector incompatible):
  the condition ends on its own. The occurrence resolves when it does, taking its
  acknowledgement with it. If it recurs, that is a new occurrence, `open` again.
- **Persistent** (SMART attribute faults, SMART health failed): the condition does not
  go away; a disk does not unlearn pending sectors. Acknowledgement and acceptance are
  level-based ([042](042-Acknowledge-faults.md)): they hold until the value rises, then
  the occurrence goes back to `open`. Resolves only if the attribute returns to
  `passed` or the disk leaves service (`dead`, `retired`, `sold`), so the record of a
  disk's faults lasts as long as the disk.

### Kinds

| kind | category | lifetime | severity | key | actions |
| --- | --- | --- | --- | --- | --- |
| `smart-attribute` | disk | persistent | attribute status | `diskId:attrId` | acknowledge, accept, clear |
| `smart-health-failed` | disk | persistent | error | `diskId` | acknowledge, clear |
| `disk-missing` | disk | transient | error | `diskId` | acknowledge, clear |
| `identity-conflict` | disk | until acknowledged | error | `diskId:<sorted diskIds>` | acknowledge (resolves it) |
| `smart-counters-reset` | disk | persistent | warning | `diskId` | accept, clear ([083](083-Seagate-FARM-log.md)) |
| `pool-degraded` | zfs | transient | by state, 037 `zfsStateColour` | `poolId` | acknowledge, accept, clear |
| `pool-missing` | zfs | until seen again | warning | `poolId` | acknowledge, accept, clear |
| `leaf-errors` | zfs | until resolved by hand | warning on a leaf, error on a group | `poolId:vdevGuid` | acknowledge, accept, clear, resolve |
| `leaf-slow` | zfs | transient | warning | `poolId:vdevGuid` | acknowledge, accept, clear |
| `pool-data-errors` | zfs | until no data errors | error | `poolId` | acknowledge, clear |
| `scrub-overdue` | zfs | transient | warning | `poolId` | acknowledge, accept, clear |
| `pool-status` | zfs | transient | by message id ([046](046-ZFS-fault-coverage.md)) | `poolId:msgid` | acknowledge, accept, clear |
| `scrub-paused` | zfs | transient | warning | `poolId` | acknowledge, accept, clear |
| `scan-stalled` | zfs | transient | warning; error for a resilver | `poolId` | acknowledge, clear |
| `vdev-unredundant` | zfs | transient | warning | `poolId:vdevGuid` | acknowledge, accept, clear |
| `collector-silent` | host | transient | error | `hostId` | acknowledge, clear |
| `collector-incompatible` | host | transient | error | `hostId:version` | acknowledge, clear |
| `collector-outdated` | host | transient | warning | `hostId:version` | acknowledge, clear |

Clear takes an acknowledgement or acceptance back to `open`, so a mistaken click can be
undone; identity conflicts have none because acknowledging resolves them.

One fault per SMART attribute, the grain acknowledge and accept already work at
(nothing in code derives a per-disk fault today; the `disk-failed` alert rule stays as
it is). Disk status is unchanged (worst of health and un-accepted attributes); the
faults page shows why.

`identity-conflict` is the exception to "acknowledge never resolves": there is no merge
or delete for disks, so the conflict cannot clear by itself. Acknowledging resolves it;
a different set of disks is a new key and opens a new fault.

Accept on a transient kind is "this state is intended", e.g. a pool deliberately
`DEGRADED` with a leaf `OFFLINE`. It ends with the occurrence. Collector faults are
never acceptable: they stay live until the collector is upgraded. SMART health failed
has no accept: the drive itself says it is dying (as 042).

Leaving service: `dead`, `retired`, `sold` resolve a disk's persistent faults.
`removed` does not (it is also inferred for a disk that is just unplugged, and may come
back); the faults stay live on the disk until it is overridden or returns healthy.

Vanished pools (exported, destroyed) keep their last `Pool.state`. Pool detectors only
consider pools in their host's latest `zpool-status`; a pool not in it resolves its
faults.

A kind declares lifetime, actions and how to render its title in one table in
`shared/faults.ts`, so the page renders from data, and a new kind (§Future kinds) is
one entry plus a detector.

## Contract

### Data

Table `Fault`: id, kind, category, subjectType (`disk | pool | host`), subjectId (no
FK, as `DiaryEntry.subjectId`), key, severity, data (json: the facts the title is
rendered from, e.g. `{ attrId, value }`, `{ state }`, `{ version, minVersion }`,
`{ lastOkAt }`), openedAt, lastSeenAt, resolvedAt?, state (`open | acknowledged |
accepted | resolved`), stateChangedAt, note default ''. Partial unique index
`Fault_kind_key_live` on (kind, key) `WHERE resolvedAt IS NULL` (drizzle
`uniqueIndex(...).on(...).where(sql...)`; first in `schema.ts`). Index (state),
(subjectType, subjectId). Migration `fault`; `MIGRATION_COUNT` 13 → 14.

Titles are rendered from `kind` + `data` by a shared function, not stored, so "No data
for 9 d" and "since" ages stay current.

### SMART state

`FaultAcceptance` stays the source of truth for the level rule. `acceptFault`,
`clearAcceptance` and `supersedeIfRisen` (`server/services/acceptance.ts`) update the
matching `smart-attribute` row in the same transaction, so both pages agree at once:

| acceptance | fault state |
| --- | --- |
| active, kind `acknowledge` | `acknowledged` |
| active, kind `accept` | `accepted` |
| superseded or cleared | `open` |
| attribute back to `passed`, or disk `dead | retired | sold` | `resolved` |

Sync reconciles the same mapping, as a safety net. A `warning → failed` change implies a
rise, so 042's supersede already reopens the row; sync then raises its severity.

### Sync

`server/services/faults.ts`: `syncFaults(now)` runs every detector fleet-wide, then per
kind: open a row for a new key, update `lastSeenAt`, `severity` and `data` for one still
present, resolve a row whose key has gone. A severity rise on an `acknowledged` or
`accepted` non-SMART row sets it back to `open` (the 042 supersede rule for other kinds,
e.g. pool `DEGRADED → FAULTED`).

Called from `runAlertsPass` (`server/services/alerts/dispatch.ts`) right after
`listDisks(now)`, which is where `missing` transitions are materialised. That pass
already runs after every ingest (`requestAlertsTick`) and every 5 min, so ingest gets
no new seam and time-based kinds (`collector-silent`, `disk-missing`) are covered in the
same place. Sync runs before deriving alerts and even when no channel is configured or
in the demo (move it above those early returns).

When sync changes anything it pushes a new SSE event `faults` (`shared/sse.ts`,
`server/sse.ts`); `useFaults()` refreshes on it.

Detectors reuse what exists: `allGroupFreshness` / `isEveryGroupSilent` /
`isHostOffline` from `shared/hostFreshness.ts` (intermittent hosts never fault,
[039](039-Intermittent-hosts.md); pass `DEMO_CADENCES` when `isDemo()`, as the client
does today), `collectorStatus`, `latestAttributes` (`displayStatus` for state),
`healthStatus` on the latest reading, disk state from `listDisks`, pool state and scan,
the latest `identity-conflict` diary entry per disk.

Diary: non-SMART transitions write `fault-opened`, `fault-resolved` and
`fault-state-changed` (`data: { faultId, kind, key, from, to, note }`). SMART kinds
write nothing new; their 042 events already cover it. `fault-dismissed` and
`fault-restored` (never used) are removed from `shared/diary.ts` and the icon map.

### Backfill

The migration creates the table only. A task `faults:backfill` (`shared/tasks.ts`
`TASK_NAMES`, `server/tasks/router.ts`) is queued once at boot by
`server/plugins/migrate.ts` when `Setting.config.faultsBackfilledAt` is unset, and can
be run again from the tasks UI. Idempotent by construction: delete every `Fault` row,
replay, then `syncFaults(now)` for what is live.

Replay per kind, oldest first:

| kind | from |
| --- | --- |
| `smart-attribute` | `attribute-status-changed` opens/resolves; 042 `fault-*` / `*-superseded` / `*-cleared` set state |
| `smart-health-failed` | `SmartReading.smartPassed` / `exitStatus` history through `healthStatus` (the diary cannot tell health failure from attribute failure) |
| `disk-missing` | `state-changed` to and from `missing` |
| `pool-degraded` | `pool-state-changed` |
| `scan-errors` | `scrub-finished` / `resilver-finished` with `errors > 0`, resolved by the next clean one (historical: now `pool-data-errors`, whose backfill is in [046](046-ZFS-fault-coverage.md)) |
| `identity-conflict` | `identity-conflict` entries |
| `collector-incompatible` | `collector-status-changed` |
| any non-SMART | `fault-state-changed` for acknowledgements (none exist before this task) |

Gaps, which start at the final sync with `openedAt = now`: `collector-silent` (no
trail); `smart-counters-reset` (only the latest FARM log is kept); attributes failing on their first reading, after a scrutiny import or after
`reapplySmartPolicy` (no `attribute-status-changed`); `collector-outdated` for a host
first seen outdated (first sighting writes no entry).

### API

- `GET /api/faults?state=&category=&severity=&host=&subject=` →
  `{ faults, counts: { open, acknowledged, accepted, resolved } }`. `counts`
  for the current filter minus `state`. The nav badge moved to `GET /api/navigation`
  ([048](048-Sidebar-status-counts.md)).
  Default `state=open,acknowledged`. `host` resolves through the subject's current
  host (disks move), as `describeSubject` in `alerts/rules.ts` does.
- `POST /api/faults/:id/acknowledge` `{ note? }`, `POST /api/faults/:id/accept`
  `{ note? }`, `DELETE /api/faults/:id/acknowledgement` (back to `open`). 409 when
  the kind does not allow the action or the fault is resolved. SMART kinds delegate to
  `acceptFault` / `clearAcceptance`, so the disk page and the faults page are the same
  operation.

### Page

`/faults`, nav entry after Topology, `i-lucide-siren`. `NavigationEntry`
(`app/utils/navigation.ts`) gains an optional badge; `AppSidebar.vue` fills it from
`useNavigationCounts()` ([048](048-Sidebar-status-counts.md)). Colour `error`, none at
zero. Command palette entry.

```
Faults                                    [Live ▾] [All categories ▾] [All hosts ▾]
                                          Live 4 · Accepted 2 · Resolved 31

┃ atlas  A7   Reallocated Sectors Count 24, worsening      since 6 d   → disk   Acknowledge ▾
┃ styx         Pool vault DEGRADED                         since 1 h   → pool   Acknowledge ▾
│ atlas  A12  Current Pending Sector Count 2 · ack at 2    since 6 d   → disk   Accept · Clear
│ bench        Collector 0.3.0 is behind 0.3.1             since 6 d   [curl … ⧉] Acknowledge
```

- State filter is a segmented control: Live (open + acknowledged, default), Accepted,
  Resolved, All. Category, severity and host are selects. Filters live in the query
  string so a view can be linked.
- Gutter: red open error, amber open warning or acknowledged anything, none for
  accepted and resolved (resolved rows dimmed, "resolved 3 d ago").
- Actions from the kind table. SMART rows open the existing `AcceptFaultModal` (same
  history and reference values); others a small note popover.
- Row click goes to the subject: disk page, pool page (`/zfs/:id`), `/settings/hosts`.
- Empty Live view: "Nothing needs attention" and the time of the last ingest.

### Banner strip

Open **error** faults only, capped at three with "and 2 more → Faults". The ✕ becomes
Acknowledge (same endpoint). `useFaults()` becomes a thin `useFetch("/api/faults")`,
polled every 30 s and refreshed on the SSE `faults` event; the collector rules move to
the service; `localStorage` dismissals are dropped.

### Alerts

Unchanged for now: alerts stay driven by diary entries. A test maps each `alert`
severity rule in `ALERT_RULES` to a fault kind or `null` (`disk-failed` fires on
attribute failure too, so it is not 1:1), so a new rule or kind without the other
fails. Later, alerts could fire from fault transitions instead (open, reopen), which
would remove the per-entry suppression flags 042 added; out of scope here.

### Demo

Every feature seeds in the demo ([034](034-Cloudflare-Workers-demo.md)). The seed calls
`syncFaults(instant.at)` after `listDisks(instant.at)` at each replay instant, so
history carries real timestamps; the Cloudflare tick path calls it too (no scheduled
tasks there). Today's stories already give: A7 superseded acknowledgement (open), A12
acknowledged, A3 accepted, V5 `disk-missing` (open), V2 health failed then `dead`
(resolved), vault `DEGRADED → ONLINE` (resolved). Add:

- `bench` runs collector 0.3.0 (per-host producer in `hostPayloadsAt`), giving
  `collector-outdated`.
- V5's `disk-missing` acknowledged with a note ("Pulled for RMA").

`seed.test.ts` asserts the Live/Accepted/Resolved counts.

### Tests

- `server/services/faults.test.ts`: per kind: open, still open, resolve; transient
  acknowledgement ends with the occurrence and a recurrence opens a new row; severity
  rise reopens; SMART mapping including supersede and leaving service; vanished pool
  resolves; intermittent host never faults; actions refused per kind.
- `server/tasks/` backfill: replay from a seeded diary, re-run gives the same rows.
- `test/api/faults.e2e.test.ts`: filters, counts, badge, acknowledge, accept, clear,
  409s.
- `useFaults.test.ts` rewritten (it tests the client rules being removed);
  `AppFaultBanners.test.ts`: cap, overflow row, acknowledge instead of dismiss.
- `AppSidebar` badge; page default filter, query-string round trip, actions per kind.
- `MIGRATION_COUNT`, `TASK_NAMES`, demo seed counts.

### Docs

On landing: 037 §Faults (states, gutter; drop "dismissed") and diary icons; 003 fault
banners and data model; 035 §Fault (rules move server-side); 039 (no
`collector-silent` while offline, now enforced server-side).

## Future kinds

Each of these adds a kind entry and a detector when it lands; the page needs no change.

| task | kind | lifetime | severity |
| --- | --- | --- | --- |
| [015 Replication health](015-Replication-health.md) | `replication-delayed` per dataset pair | transient | error past the pair's tolerance |
| [016 Snapshot staleness](016-Snapshot-staleness.md) | `snapshot-stale` per dataset | transient | warning |
| [017 Scrub and self-test overdue](017-Scrub-and-self-test-overdue.md) | `self-test-overdue` per disk (`scrub-overdue` landed with [046](046-ZFS-fault-coverage.md)) | transient | warning |
| [018 Capacity forecast](018-Capacity-forecast.md) | `pool-filling` | transient | warning |
| [019 SSD endurance](019-SSD-endurance.md) | `ssd-endurance-low` per disk | persistent | warning, error near the limit |
| [020 Warranty nudge](020-Warranty-nudge.md) | `warranty-ending` per disk | transient | warning |
| [080 Vendor override and warranty links](080-Vendor-override-warranty-check-links-and-vendor-SMART-hints.md) | `inventory-incomplete` per disk | transient | warning |

## Out of scope

- Snooze until a date.
- Alerts driven from fault transitions (see §Alerts).
- Notifications on acknowledge or accept.

## As built

- Clear (back to `open`) is offered on every kind except `identity-conflict`.
- Backfill also replays `fault-opened` / `fault-resolved` (keeps acknowledgements of
  gap kinds across re-runs), `override-set` to `dead | retired | sold`, and
  `collector-outdated` from `collector-status-changed`. Replayed rows for past
  occurrences carry today's names (pool name); live rows are corrected by the final sync.
- `smart-health-failed` writes no diary entry on open or resolve; its acknowledgement
  does (`fault-state-changed`), as nothing else records it.
- "No data for" counts from the newest successful run.
- `NavigationEntry.badge` is a key (`"faults"`) the sidebar resolves, since
  `NAVIGATION` is static. Since 048 the badge has its own request
  (`/api/navigation`); the banners keep the open-errors one.
- `fault-opened` entries carry `severity` (since 046 part C), which backfill uses for
  past rows. Possible follow-up: store `data` too so a backfill can rebuild past rows
  exactly.

## Open questions

None. Decided 2026-10-02: backfill history from the diary; collector faults stay live
until fixed (acknowledge only); resolved faults are kept forever.
