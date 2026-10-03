---
type: task
status: todo
---

# Sidebar status counts

Faults, Disks and ZFS nav entries each show up to three counts, coloured per
[037](037-Status-and-icon-vocabulary.md). Today only Faults has a badge: open errors,
red. Open warnings are invisible from the nav.

Depends on [049](049-Missing-pool-display-state.md): the ZFS count buckets by its pool
display state, so a missing pool is amber.

## Counts

Badges in order red, amber, neutral. A zero count hides its badge.

| entry | `error` (red) | `warning` (amber) | `neutral` |
| --- | --- | --- | --- |
| Faults | open, severity `error` (today's badge) | open, severity `warning` | none |
| Disks | SMART `failed` | SMART `warning` | SMART `passed` or `unknown` |
| ZFS | pools whose `zfsStateColour` is `error` (`FAULTED`, `UNAVAIL`, `SUSPENDED`) | `warning` (`DEGRADED`, `OFFLINE`, `REMOVED`, `MISSING`, unknown) | `success` (`ONLINE`) |

- Faults amber: `open` + `warning` only. `acknowledged` stays uncounted, as 037's
  faults table says; acknowledging is how a fault leaves the nav.
- Disks: colour by `Disk.latestStatus` (stored, `effectiveDeviceStatus`), not
  lifecycle state. Acknowledged attributes keep a disk `warning` (037), so a disk
  whose faults are all acknowledged is in Disks amber but not Faults amber; an
  acknowledged *failed* attribute makes the disk amber and its `error` fault is in
  neither Faults badge. Accepted attributes drop out, so an accepted-only disk is
  `passed`. Intended: Disks counts disk health, Faults counts unattended faults.
- Disks: history disks (`dead`, `retired`, `sold`) excluded, else a dead disk that
  failed SMART is red forever, against 037's "history, not a problem". `unknown`
  counts as neutral: not knowing is not a problem.
- ZFS: archived pools ([047](047-Archive-pools.md)) excluded. ONLINE neutral, not
  green: the badge is a count, not ZFS's word, and 037 keeps green off surfaces.
- Faults page `Live` chip is open + acknowledged for the current filter; it is not
  meant to match the nav number.

## Build

- `NavigationCounts` type in new `shared/navigation.ts` (server and app both need
  it); `NAVIGATION` stays in `app/utils/navigation.ts`.
  `{ faults: { error, warning }, disks: { error, warning, neutral }, pools: { error,
  warning, neutral } }`.
- `GET /api/navigation` → `server/services/navigation.ts`, one `GROUP BY` each:
  - faults: `state = open` by `severity`.
  - disks: `latestStatus`, where `stateOverride` is null or not a history state. The
    three are override-only (`STATE_OVERRIDES`), so no effective-state resolution.
    Do not call `listDisks()`: it writes `lastState` transitions and diary entries
    on read.
  - pools: `archivedAt IS NULL`, bucketed by `zfsStateColour` of the display state
    (049's missing rule).
- History set: move `LEFT_SERVICE_STATES` (`server/services/faults.ts`) to
  `shared/disk.ts` as `HISTORY_STATES`; use it in `faults.ts`, `faultsBackfill.ts`,
  the simulator and `groupDisks.ts` (replacing its local `HISTORY_STATES`).
- Drop `badge` from `FaultsResponse` and `faultBadge()`. Only `AppSidebar` renders
  it; also update `useFaults` (+ test), `test/api/faults.e2e.test.ts`,
  `server/services/faults.test.ts`, `app/pages/faults.test.ts` fixture, and amend
  [036](036-Faults-page.md) API/page sections to point here.
- `useNavigationCounts()` composable: `useFetch`, 30 s poll and refresh on the
  `faults` SSE event, as `useFaults` does. A red/amber disk or pool change always
  changes a fault row on the next `alerts:tick` (queued after each ingest), which
  pushes `faults`. Between ingest and tick the Disks count can lead Faults by one
  task; neutral drift (new disk, new pool) and SMART policy re-applies rely on the
  poll.
- `NavigationBadge` grows `"disks" | "pools"`; Disks and ZFS entries get `badge`.
- Expanded: `#item-trailing` slot renders `AppNavCounts` (`error` / `warning`
  `solid`, neutral `subtle`, size `sm`). The slot replaces the default `UBadge`, so
  items carry no `badge` prop. Theme already hides trailing when collapsed.
- Collapsed: item `chip: { color }` (worst non-zero, `error` else `warning`; none
  when only neutral). `UNavigationMenu` wraps the icon in `UChip` itself, but in
  expanded mode too, so set `chip` only when collapsed: read it via
  `UDashboardSidebar` `v-model:collapsed` in `mainLinks`.

## Tests

- Navigation service: each bucket; history disks and archived pools excluded;
  `unknown` neutral; acknowledged-only disk amber, accepted-only disk not; missing
  pool amber.
- `app/utils/navigation.test.ts`: Disks and ZFS badge keys.
- `AppSidebar.test.ts`: mock `useNavigationCounts`; badges per entry, zeros hidden,
  order red → amber → neutral, collapsed chip colour and no chip expanded.
- e2e: `GET /api/navigation` shape.
