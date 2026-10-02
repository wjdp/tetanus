---
type: task
status: todo
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

## Open questions

1. Test pools are recreated with new guids each time. Also want a per-host ignore rule
   by name pattern (e.g. `t*`) that archives new matching pools on first sight?
2. Hard delete as well (cascade vdevs, readings, datasets, snapshots, diary), offered
   only for archived pools? Archive alone keeps the database growing with junk.
3. Order against 046: land this first (small, and `pool-missing` would immediately
   fire for `tfault` / `tspare`), or after?
