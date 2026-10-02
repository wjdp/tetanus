---
type: task
status: done
---

# Archive pools

Hide pools you don't care about (test pools, pools exported for good) from every list,
status and fault, keeping their history. Spec'd 2026-10-02 after the `tfault` and
`tspare` test pools built for [046](046-ZFS-fault-coverage.md) landed in mars's
database.

## Why

A pool, once seen, is in tetanus forever: ZFS list, topology, home page, datasets,
diary. Once 046 lands, a vanished pool also opens `pool-missing`. A pool that existed
for ten minutes to capture a fixture should not look like a lost pool.

Same shape as disk disposal ([040](040-Disk-disposal.md)): a record on the subject,
hidden by default, opt-in to show, history kept.

## Contract

### Schema

`Pool.archivedAt` datetime nullable, `Pool.archiveNote` text default `''`. Migration
`pool_archive`.

### Behaviour

- Archived pools are hidden from the ZFS list, topology, home page, datasets lists,
  capacity charts and the command palette. The pool page still works and shows an
  "Archived <date> · note" banner with Unarchive.
- ZFS list gains a "Show archived" toggle (query string, as the disks list opt-in).
- Archiving resolves the pool's live faults (diary `fault-resolved`, `data.reason:
  "archived"`). Fault detectors skip archived pools (`currentPools()` filter), so no
  `pool-degraded`, `pool-missing`, `leaf-*`, `scrub-overdue` and so on.
- Alert rules skip diary entries for archived pools.
- Ingest carries on: a still-imported archived pool keeps updating its rows and diary
  quietly. Seeing it again does not unarchive it or alert (unlike a disposed disk:
  archiving means "don't care", not "gone").
- A recreated pool with the same name has a new guid, so it is a new `Pool` row and is
  not archived (see Q1).
- Disk page membership of a leaf in an archived pool: dimmed, "archived pool".
- Diary `pool-archived` (`data: { note }`) and `pool-unarchived`; icons in 037.

### API

- `POST /api/pools/:id/archive` `{ note? }` → 200; 409 if already archived.
- `DELETE /api/pools/:id/archive` → 200; 409 if not archived.
- `GET /api/pools?archived=include|only` (default exclude).

Schemas in `shared/schemas/pools.ts`; service functions in `server/services/zfs.ts`
throwing `ServiceError`.

### UI

- Pool page header menu: Archive (modal with optional note) / Unarchive.
- Faults page: `pool-missing` rows (046) get an "Archive pool" action alongside
  acknowledge / accept, since a missing pool is the usual reason to archive.
- ZFS list toggle and a dimmed "archived" badge on rows when shown.

### Demo

One archived test pool on a demo host, so the toggle and banner have something to
show.

### Tests

Service: archive / unarchive, faults resolved, detectors skip, alerts skip, ingest of
an archived pool keeps it archived. E2E: routes and 409s. Pages: list toggle, banner,
modal.

## Steps

1. Migration, service functions, diary types, routes, tests.
2. Filter archived pools from list / topology / home / datasets queries; fault
   detectors and alert rules skip them.
3. Pool page banner and menu; ZFS list toggle; faults page action.
4. Demo seed; 037 icons; 003 data model note.
5. Archive `tfault` and `tspare` on mars.

## As built

Steps 1–4; step 5 (archive `tfault` and `tspare` on mars) is left to do by hand.

- Migration `0020_pool_archive`. Service in `server/services/zfs/archive.ts`
  (`archivePool`, `unarchivePool`), exported through `server/services/zfs.ts`. Both
  routes queue `alerts:tick` like the config PATCH, so faults resync.
- Archiving resolves every live fault whose subject is the pool (all of
  `POOL_FAULT_KINDS`, leaf and vdev faults keyed `poolId:vdevGuid` included) through
  `resolvePoolFaults` in `faults.ts`, diary `fault-resolved` with `data.reason:
  "archived"`. `resolveFault` now takes extra diary data instead of only
  `supersededBy`. Unarchiving resolves nothing and opens nothing itself; the next sync
  re-detects.
- `detectPoolFaults` reads only pools with `archivedAt` null, so an archived pool on a
  silent host is not superseded by `collector-silent` either (its faults are already
  resolved).
- Disk faults stay independent: an archived pool supersedes nothing, so a member disk
  that goes missing raises `disk-missing` (the disk is real hardware), where a live
  missing or degraded pool would have folded it.
- Alerts: `AlertPool` gains `archived`; `deriveAlert` drops any match whose subject is
  an archived pool, which covers `vdev-state-changed` (mapped to its pool) as well as
  pool entries. Disk entries are unaffected.
- Backfill replays `pool-archived` (resolves the pool's replayed faults) and
  `pool-unarchived`, and skips pool and vdev entries while the pool is archived. Pool
  state replayed while archived is lost, so after an unarchive the replay starts from
  the next entry; the final sync corrects the live rows.
- Hidden: `GET /api/pools` defaults to `exclude`, which covers the ZFS list, topology
  (home), the command palette and the diary subject pickers. `searchDatasets` skips
  archived pools; `listDatasets(poolId)`, `getDataset` and `lookupDatasets(ids)` still
  serve them so the pool page and diary links work. No snapshot-staleness detector
  exists yet; when one lands it should read pools through the same filter.
- Disks of an archived pool are not in any `/api/pools` vdev tree, so topology puts
  them in the host's rails like unpooled disks. `DiskMembership` gains
  `poolArchived`; a disk in both an archived and a live pool reports the live one.
- UI: pool page header has a `…` menu (Archive… / Unarchive) beside the simulate menu
  and a neutral banner "Archived <date> · note" with Unarchive.
  `PoolArchiveModal` (`app/components/pool/ArchiveModal.vue`) is shared with the
  faults page, where open `pool-missing` rows get "Archive pool" in `FaultActions`.
  ZFS list: "Show archived" switch kept in `?archived=include`, archived rows muted
  with an outline "archived" badge. Disk page membership is dimmed with an "archived
  pool" badge.
- Demo: `seeds.archivedPools` holds `tfault` on atlas, a file-backed mirror inserted
  directly (it never reaches a `zpool-status`) and archived three hours after creation,
  nine days before the anchor. Without the archive it would be `pool-missing`.

## Open questions

1. Test pools are recreated with new guids each time. Also want a per-host ignore rule
   by name pattern (e.g. `t*`) that archives new matching pools on first sight?
2. Hard delete as well (cascade vdevs, readings, datasets, snapshots, diary), offered
   only for archived pools? Archive alone keeps the database growing with junk.

Decided 2026-10-02: land on the `fault-simulator` branch after 046 part B and before
the branch is merged or deployed, so `pool-missing` never fires for `tfault` /
`tspare` on mars.
