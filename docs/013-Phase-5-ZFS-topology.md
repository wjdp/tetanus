---
type: task
status: todo
---

# Phase 5 ZFS topology

Phase 5 of the [project plan](004-Project-plan.md): pools and vdevs from
`zpool-status` + `zpool-list`, readings, events and history, topology UI.

## Contract

### Upsert (`server/services/zfs.ts`)

- `zpool-status` handler: per pool upsert `Pool` on `guid` (move `hostId` if it
  changed → diary `pool-moved`), then upsert every vdev on `guid`: `parentId` from
  `parentGuid`, `type`, `state`, error counters, `slowIos`, `path`, `devid`, `physPath`,
  `lastSeenAt`, `present=true`. Vdevs of that pool not in this payload → `present=false`
  and diary `vdev-left` once. New vdev → diary `vdev-joined`. State change → diary
  `vdev-state-changed` / `pool-state-changed`. Scan finished (`scan.state` transition
  to finished with a new `endTime`) → diary `scan-finished` with errors count.
- Link `Vdev.diskId`: leaf vdevs by `path` (basename of `/dev/disk/by-vdev/<alias>` →
  `Disk.alias`; `/dev/disk/by-id/<name>` → `DiskKey(by-id)`), else by `devid`
  (`ata-...`, `wwn-...` forms map to by-id keys). Unlinked leaves stay `diskId=null`.
- `PoolReading` per ingest. `VdevReading` only when counters or state differ from the
  previous row for that vdev (10-min cadence would otherwise be 150k rows/yr).
- `zpool-list` handler: `sizeBytes`, `allocBytes`, `freeBytes`, `frag`, `cap`, `dedup`,
  `health` onto `Pool`.
- `zpool-events` and `zed-event` handlers: insert `ZfsEvent` deduped on
  `(hostId, eid)` when `eid` is set, else on `(hostId, at, class)`. Gap detection: a
  jump in `eid` > 1 from the last stored for that host → diary `events-gap` on the host.
- `zpool-history` handler: `PoolHistory` rows keyed on `(hostId, at, text)`, `poolId`
  nullable (the `tail -n 500` cut drops headers; see 010 findings).

### API

`GET /api/pools` → pools with host, state, capacity, scan, vdev tree (nested, with
linked disk alias/state). `GET /api/pools/:id` adds recent `PoolReading` series,
diary entries, last 50 `PoolHistory` and `ZfsEvent` rows for the pool.

### UI (wave 4)

Home `/` topology: grouped by host, pools → vdevs → disk tiles by alias, coloured by
effective disk status per [008](008-Branding-and-colour.md); side rail listing spares,
missing, removed, unseen. Header per host: collector freshness chips reused from
`app/utils/hostFreshness.ts`, active scan/resilver. `/zfs` lists pools; `/zfs/:id` pool
page with scan state, error counters, capacity history, events and history tail.

## Findings

(agents append here)
