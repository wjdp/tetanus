---
type: task
status: in-progress
---

# Silent host does not make its disks missing

When a collector stops posting, every disk on that host passes `PRESENT_WINDOW_MS`
and goes `missing`: one `collector-silent` fault plus a `disk-missing` fault, diary
entry and alert per disk. A 24-bay host is 25 faults for one cause. Spec'd 2026-10-02.

Rule: a disk is **missing** only when its host is reporting and the disk is absent
from the scan. A host that is not reporting is the host's fault (`collector-silent`),
not its disks'.

## Mechanism

[039](039-Intermittent-hosts.md) already does this for intermittent hosts: disk state
is judged as of the host's latest ok disk-sighting run (`lsblk`, `smartctl-scan`), not
`now`. Generalise it to every host.

- `server/services/hosts.ts`: `intermittentSightingTimes` → `diskSightingTimes`, drop
  the `host.intermittent` filter.
- `server/services/disks.ts` `stateResolver`: use it unchanged
  (`referenceAt = min(now, lastSightingAt)` for `isPresent` and `missingAfterDays`
  ageing).
- `intermittent` keeps its remaining job: suppresses `collector-silent`, offline chip,
  no Healthchecks URL.

## Behaviour

| Situation | Disk state | Faults |
| --- | --- | --- |
| Host silent | as of last scan (`in-use` / `spare`) | `collector-silent` only |
| Host up, disk absent from scan | `missing` → `removed` after N days | `disk-missing` |
| Host up, sighting group stale, zfs fresh | as of last sighting scan | smart group freshness warning (unchanged) |
| Host returns | unchanged; no diary entry | `collector-silent` clears |
| Disk pulled while host silent | stays present until next scan, then `missing` | as above, on return |
| Host never returns | disks never age to `removed` | `collector-silent` persists |

Last row is acceptable: the host fault is the signal, and the user can override disk
state or delete the host.

## Rollout

Disks already `missing` because their host is silent flip back to `in-use` / `spare`
on the next resolve, writing a `state-changed` diary entry and firing
`disk-reappeared`. Accepted as a one-off (decided 2026-10-02).

## Stale state hint

A disk whose state is judged as of an old scan says so (decided 2026-10-02).

- `StateSnapshot` gains `stateAsOf: Date | null`: `referenceAt` when
  `now - referenceAt > PRESENT_WINDOW_MS`, else `null`. Applies to intermittent hosts
  too.
- Disk DTOs (inventory list, disk detail) carry `stateAsOf: string | null`.
- `LifecycleBadge` gains `asOf?: string`: muted (reduced opacity), `title` "as of last
  scan 9 d ago" via `formatDuration`. Composes with `overridden` (override wins the
  title; an overridden state is not stale).
- Pass it from `InventoryTable`, `InventoryCards`, `DiskStateControl`.
- Add the muted variant to [037](037-Status-and-icon-vocabulary.md).

## Changes

- `hosts.ts`, `disks.ts`: as above.
- `server/services/simulator/scenarios/presence.ts` `sightingReference`: use
  `diskSightingTimes`; drop the intermittent wording.
- `server/services/simulator/scenarios/host.ts` `collectorSilent.description`: drop
  "Its disks go missing with it".
- `docs/003-Architecture-and-data-model.md` §Disk state: "device absent" means absent
  from the host's latest disk-sighting scan.
- [039](039-Intermittent-hosts.md): note that the disk-state reference time now applies
  to all hosts.

## Tests

- `disks.test.ts`: non-intermittent host silent past `PRESENT_WINDOW_MS` → disks keep
  state, no `state-changed` entry; host posts a scan omitting one disk → only that disk
  `missing`.
- `faults.test.ts`: silent host → one `collector-silent`, zero `disk-missing`.
- Simulator: `collector-silent` scenario leaves disk states unchanged; `disk-missing`
  scenario still produces `missing` on a reporting host.
- Existing intermittent-host tests still pass.
- `stateAsOf`: null on a reporting host, last scan time on a silent one, null when
  overridden.
- `LifecycleBadge.test.ts`: `asOf` renders muted with the title.
