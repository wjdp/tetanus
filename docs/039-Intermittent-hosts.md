---
type: task
status: in-progress
---

# Intermittent hosts

A per-host setting for machines that are off more than they are on (test benches,
cold spares, a desktop that runs a pool now and then). Today a host that stops
reporting is treated as a fault and its disks age into `missing` then `removed`, which
is right for the NAS and noise for a bench that was switched off on purpose. Spec'd
2026-09-29.

Rule: an intermittent host being **off** is not a fault. Anything wrong while it is
**on** still is.

## What alerts today when a host goes quiet

| Source | Where | Effect on an off host |
| --- | --- | --- |
| `collector-silent` fault | `app/composables/useFaults.ts` | banner "No data for 9 d" once every group is non-ok |
| Freshness chips | `shared/hostFreshness.ts`, host header, `settings/hosts.vue` | `warning` after 2× cadence, `error` if never seen |
| Healthchecks ping | `server/services/healthchecks.ts` | `POST <url>/fail` naming stale groups |
| Disk state | `inferState` / `stateResolver` in `server/services/disks.ts` | disks leave `isPresent` after `PRESENT_WINDOW_MS` (2 h) → `missing` → `removed` after `missingAfterDays`; `recordStateTransition` writes `state-changed` diary entries → `disk-missing` alert |

The last row is the loud one: every disk on a switched-off bench fires `disk-missing`
two hours later.

## Contract

### Schema

`Host.intermittent: boolean().notNull().default(false)`. Migration
`host_intermittent`. `hostPatchSchema` gains `intermittent: z.boolean().optional()`.

Intermittent hosts have no Healthchecks URL (decided 2026-09-29): Healthchecks alarms
on a missed ping, which is exactly what an intermittent host does. `updateHost`:

- setting `intermittent: true` clears `healthchecksUrl`;
- a patch that leaves the host intermittent with a non-null `healthchecksUrl` throws
  `ServiceError(400)`.

### Offline

A host is **offline** when `intermittent` and every freshness group is non-ok (same
test `useFaults` already uses for `collector-silent`). Put it in
`shared/hostFreshness.ts`:

```ts
export function isHostOffline(
  host: { intermittent: boolean; lastRuns: Record<string, RunLike | undefined> },
  now: number,
  cadences?: CadenceOverrides,
): boolean;
```

A non-intermittent host is never offline; it is silent, as today.

### Behaviour when offline

- **Fault**: no `collector-silent`. Other faults (collector incompatible) still show.
- **Freshness**: host header and hosts page show one neutral chip
  `offline · last seen 9 d` in place of the per-group chips.
- **Disk state**: disks whose `lastSeenHostId` is the host are evaluated as of the
  host's last contact, not `now` (below).

### Behaviour when online

Unchanged. Partial staleness (zfs fresh, smart stale) is a `warning` chip as today: the
collector is up and something in it is broken. No Healthchecks ping either way, as the
host has no URL.

### Disk state reference time

In `stateResolver`, for a disk whose `lastSeenHostId` host is intermittent, use
`referenceAt = min(now, lastSmartScanAt)` for both `isPresent` and the
`missingAfterDays` ageing, where `lastSmartScanAt` is that host's latest ok run of the
disk-sighting sources (`lsblk`, `smartctl-scan`).

- Host off for weeks: disks stay `in-use` / `spare` as of the last scan. No
  transition, no diary entry, no alert.
- Disk pulled while host is on: next scan omits it, `referenceAt` moves past its
  `lastSeenAt`, it goes `missing` exactly as on any other host.
- Host boots: zfs sources arrive before smart; using the smart scan time (not
  `Host.lastSeenAt`) avoids a false `missing` in that window.
- Disk moved from the bench to the NAS: `lastSeenHostId` changes on sighting, normal
  rules apply from then.

`lastRunsByHost` in `server/services/hosts.ts` already has the runs; expose a
host-id → reference time map to `stateResolver` rather than re-querying per disk.

### UI

- Hosts page editor: `USwitch` "Intermittent", description "Expected to be off for
  long periods. No silent-collector fault; disks keep their state while it is off."
  The Healthchecks URL field is hidden while the switch is on, and saving sends
  `healthchecksUrl: null`.
- Hosts table: `intermittent` badge (neutral) next to the name.
- Host header (Topology): offline chip as above. [038](038-Home-page-redesign-and-status-vocabulary-rollout.md)
  is reworking this header; land after 038's home page phase or fold into it.
- [037](037-Status-and-icon-vocabulary.md) §Collector freshness: add an `offline` row
  (neutral chip, `intermittent` hosts only).

### Host order

Added 2026-09-29: hosts appear on the home page, hosts page and anywhere else that
lists them in a user-set order, not by name.

- `Host.position: integer().notNull().default(0)`, in the same migration. `listHosts`
  orders by `position`, then `name`, so new hosts land first-come at 0 until moved.
- `PUT /api/hosts/order` with `hostOrderSchema = { hostIds: number[] }` (the full list,
  unique). `reorderHosts(hostIds)` writes `position = index`; unknown ids or a list
  that is not every host throws `ServiceError(400)`.
- Hosts page: up / down buttons per row (no drag library in the stack); each move
  sends the whole order.

## Order

1. Schema, migration, patch schema, `updateHost` (URL rule), `listHosts` returns the
   field.
2. `isHostOffline` + tests.
3. `useFaults` skips offline hosts.
4. Disk state reference time + tests (off for weeks, pulled while on, boot window).
5. Hosts page switch and badge; host header chip; 037 row.
6. Host order: column, service, route, hosts page buttons.
7. Demo (`server/demo/`): add or mark one seeded host intermittent, last contact
   about 12 days before the demo's `now`, with disks in a pool, so the offline chip
   and the held disk states are visible.

## Tests

- `hostFreshness.test.ts`: offline only when intermittent and all groups non-ok.
- `useFaults.test.ts`: no `collector-silent` for an offline host; still one for a
  silent non-intermittent host.
- `hosts.test.ts`: marking intermittent clears the URL; setting a URL on an
  intermittent host throws 400.
- `disks.test.ts`: the four cases under §Disk state reference time; no `state-changed`
  diary entry while offline.
- `hosts.test.ts`: `reorderHosts` sets order; rejects partial or unknown lists.
- `test/api/hosts.e2e.test.ts`: PATCH `intermittent` round-trips; PUT order changes
  `GET /api/hosts` order.

## Out of scope

- Diary entries for host offline / online transitions (decided 2026-09-29: not
  needed).
- Per-host cadence overrides (a host that reports daily, not hourly). Different
  problem: it is on, just slow.
- Muting a normal host for maintenance for a fixed window.
