---
type: task
status: in-progress
---

# Missing pool display state

A pool that vanishes keeps its last-seen `Pool.state`: a missing `ONLINE` pool shows
`ONLINE` everywhere while Faults has an amber `pool-missing`. Show `MISSING` instead.
Prerequisite for [048](048-Sidebar-status-counts.md), whose ZFS count buckets by this
display state.

## Today

Missing is derived, not stored (`server/services/poolFaults.ts`, the `pool-missing`
detection): unarchived pool, `lastSeenAt` older than the host's latest status run,
host neither silent (superseded by `collector-silent`) nor offline (intermittent, no
fault, [039](039-Intermittent-hosts.md)).

## Build

- Extract that rule into one function (`poolMissing(row, hostContext)` or a query
  helper) used by the fault detection, `listPools`, the pool detail and, later, the
  048 navigation counts. One definition, so a badge and the fault never disagree.
- Pool views gain a display state: `MISSING` in place of `state` when missing. Raw
  `state` stays on the view as the last-seen value ("last seen ONLINE").
- `zfsStateColour("MISSING")` → `warning`, explicit rather than via the unknown
  fallback. Add a `MISSING` row to 037's ZFS state table
  ([037](037-Status-and-icon-vocabulary.md)): "tetanus's word, not ZFS's; pool absent
  from the latest scan".
- Shown on: ZFS list, pool page badge, topology `PoolCard`. Vdev and leaf states
  under a missing pool stay as last seen; the pool badge carries it.
- Out of scope: pools on a silent host keep their last-seen state; the host chip
  carries it.

## Tests

- Missing rule: one set of cases shared by fault detection and display state
  (present, missing, silent host, offline intermittent host, archived).
- `zfsStateColour("MISSING")` is `warning`.
- ZFS list / pool page / `PoolCard`: `MISSING` badge for a missing pool.
- e2e: `/api/pools` and `/api/pools/:id` display state for a missing pool.
