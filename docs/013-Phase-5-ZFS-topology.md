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

### Server side (upserts and routes)

- Code: `server/services/zfs.ts` (handlers, re-exports) over `server/services/zfs/`
  `topology.ts`, `events.ts`, `history.ts`, `queries.ts`. Handlers are exported as
  `ZFS_HANDLERS` for `server/ingest/handlers.ts` to spread into `HANDLERS`.
- Use `mars/zpool-status-stored-paths.json` (`-Ppvs`, what the collector sends) as the
  realistic fixture. `mars/zpool-status.json` is `-PLpvs`: `-L` strips leaf `guid`,
  `vdev_type`, `path`, `devid` and `state`, so the parser falls back to the device
  name as guid and `UNKNOWN` state. Ingesting it would key leaves on `/dev/sda1`
  (unique across all hosts), so never collect with `-L`.
- mars leaves: 17 (15 in tank, 2 in zeta). `path` is always
  `/dev/disk/by-vdev/<alias>-part1`; `devid` is `scsi-3<naa>-part1` for the 15 SAS
  disks and `ata-<model>_<serial>-part1` for Z3/Z4. The `-partN` suffix is stripped
  before lookup. Linking tries alias, then by-id path, then devid as a by-id key,
  then `wwn-`/`scsi-3` forms as a `wwn` key.
- Links on mars: after lsblk alone 15/17 (the `scsi-3` devids via lsblk's WWN; the two
  `ata-` SSDs need udev by-id); after lsblk + udev (+ vdev-id-conf) 17/17 both by
  alias and by devid alone.
- Scan strings from the fixture: `function: "SCRUB"`, `state: "FINISHED"`,
  `endTime` in unix seconds. `scan-finished` is dated at `endTime`.
- First sighting of a pool records nothing in the diary: no `vdev-joined` and no
  `scan-finished` for a scrub that ended before install.
- A vdev that returns after `vdev-left` logs `vdev-joined` with `data.rejoined: true`.
  Left vdevs stay in the table with `present=false` and are hidden from the API tree.
- zpool-list property names: `size`, `allocated`, `free`, `fragmentation`,
  `capacity`, `dedupratio` (string `"1.00"`), `health`; `"-"` maps to null. A
  zpool-list for a pool not yet seen in zpool-status is ignored.
- Event id reset (reboot): because `ZfsEvent` is unique on `(hostId, eid)`, the new
  eids would collide with stored ones. On reset (a stored eid reappears with a
  different time, or every new eid is below the stored max with none matching) the
  host's stored eids are set to null, `events-reset` is logged once, and the new
  events are inserted. Gap detection then restarts from the new ids.
- ZfsEvent `payload` is the parser's `fields`, which drops the `pool` name; pools are
  matched on `poolGuid`.
- History on mars has no pool headers (the `tail -n 500` cut), so every row is
  `poolId` null and the pool page falls back to host scope (`historyScope: "host"`).
  A later ingest with the header fills `poolId` on existing rows.
- The pool detail `diary` merges pool and vdev subjects (vdev events are recorded
  against the vdev), so it's a direct query rather than `listDiary`.

### UI (topology and pool pages)

- Code: `app/pages/index.vue` (topology), `app/pages/zfs/index.vue` (pool list),
  `app/pages/zfs/[id].vue` (pool page), `app/components/topology/` (host section, pool
  card, disk tile, rail, status dot) and `app/components/pool/` (scan panel, vdev tree
  table). Pure helpers: `topology/groupDisks.ts` (vdev groups, rail groups, tile
  colour), `pool/scan.ts` (active scan, progress, time left), `pool/vdevRows.ts`.
- Vdev groups: each top-level vdev with children is a row labelled by name, prefixed
  with its class for special/log/dedup/spare (`special · mirror-4`). Childless top-level
  vdevs are collected into one row per class: `stripe`, `cache`, `log`, `spares`.
  Nested `replacing`/`spare` vdevs are flattened into the leaves of their group.
- Tile mark: worst of `deviceStatusColour(latestStatus)` and `zfsStateColour(vdev.state)`,
  and a `success` dot when both are quiet and SMART passed (008 "small success dot").
  Unlinked leaves are dashed, muted, show "unlinked" and the raw path in a tooltip.
- Rail is global, not per host: `/api/disks` has `hostName` but pools are per host, and
  spares or missing disks often have no meaningful host. Groups: spare, missing,
  removed, unseen, "in use, not in a pool" (in-use disks the linker could not attach
  to a vdev), dead, retired, sold.
- Active scan: any `scan.state` other than `FINISHED`/`CANCELED`/`NONE`. Time left is
  elapsed × (1 − f) / f on `examined/toExamine`; crude during the scan phase of a
  sequential scrub, which examines far faster than it issues. `issued` isn't in the
  stored scan, so the better estimate isn't possible yet.
- Pool capacity bar turns `warning` at `cap` ≥ 90 %; otherwise neutral.
- `/zfs` "Data errors" is `Pool.errors`; scrub errors sit in the "Last scrub" cell.
- Timestamps on the pool page are UTC (`YYYY-MM-DD HH:MM UTC`) to avoid SSR/client
  timezone hydration mismatches; a shared local-time formatter would be nicer.
- `UTooltip` needs the provider from `UApp`, so component tests mounting a page alone
  stub it (`app/pages/index.test.ts`).
- `.ts` files under `app/components/` are registered as bogus components
  (`TopologyGroupDisks`, `PoolScan`, ...; see `.nuxt/components.d.ts`). Harmless, but
  `components: [{ path: "~/components", extensions: ["vue"] }]` in `nuxt.config.ts`
  would stop it; the disk agent's helpers have the same issue.
- Left out: temperature on tiles, pool/vdev capacity per top-level vdev, frag history
  chart (only `allocBytes` is charted), scan history (only the current scan is
  stored), dataset tree and snapshots (Phase 6+), and per-vdev reading history.
- API gaps: `VdevNode.disk` lacks `latestTemp` and `model` (tiles would show
  temperature, the tree would show model); `PoolSummary.scan` lacks `issued`/
  `pass_start` for an accurate time-left; `GET /api/pools` has no per-host grouping or
  host `lastRuns`, so the home page fetches `/api/hosts` separately; events carry
  `vdevGuid` but not the vdev name/alias, so the events tab shows raw guids; no
  capacity series longer than `POOL_READING_DAYS` (30).
