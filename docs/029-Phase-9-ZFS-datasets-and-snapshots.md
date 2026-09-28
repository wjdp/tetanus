---
type: task
status: in-progress
---

# Phase 9 ZFS datasets and snapshots

Phase 9 of the [project plan](004-Project-plan.md): persist datasets and snapshots,
show a dataset tree per pool and a dataset page with its snapshots. Design in
[003](003-Architecture-and-data-model.md) §Data model. Feeds
[015](015-Replication-health.md), [016](016-Snapshot-staleness.md) and
[018](018-Capacity-forecast.md). Decisions agreed 2026-09-28: one dataset reading per
day, snapshots gone from the list are deleted, dataset tree as a pool tab plus a
dataset page, snapshot cadence stays 6 h.

## Contract

### Collector

`host/tetanus-collect` `collect_zfs_snapshots`: add `guid` to the `-o` list
(`name,guid,used,referenced,written,creation`). Same in `bin/capture-fixtures.sh` and
the `host/README.md` command table and [003](003-Architecture-and-data-model.md)
sources table. Bump the collector version. The mars fixture is re-captured by the user;
until then the parser treats a missing `guid` as `null` and the `Snapshot.guid` column
is nullable.

### Parsers

- `server/ingest/zfs-snapshots.ts`: `ZfsSnapshot.guid: string | null` (the JSON value is
  a number with `--json-int`; store as a decimal string, GUIDs exceed 2^53).
- `server/ingest/zfs-list.ts` is already generic; no change. The handler reads the
  properties it needs by key.

### Schema (migration `datasets_and_snapshots`)

```
Dataset         id, poolId (fk cascade), name (full name), parentId? (fk set null), type
                (filesystem|volume), mountpoint?, used, referenced, available,
                logicalUsed, compressRatio (real), usedBySnapshots, usedByDataset,
                usedByChildren, quota, refQuota, reservation, recordSize, compression,
                encryption, creation (datetime), present (bool, default true),
                firstSeenAt, lastSeenAt, latestSnapshotAt?, snapshotCount (default 0)
                unique(poolId, name); index(parentId)
DatasetReading  id, datasetId (fk cascade), at, used, referenced, available,
                usedBySnapshots   index(datasetId, at)
Snapshot        id, datasetId (fk cascade), name (part after @), guid? (text), used,
                referenced, written, creation (datetime), lastSeenAt
                unique(datasetId, name); index(guid); index(datasetId, creation)
```

`quota`/`refquota`/`reservation` of `0` mean unset; store `null`. `compressratio` is
the string `"1.01"` → real. `creation` seconds → datetime.

### Ingest handlers (`server/services/zfs/datasets.ts`, registered in `ZFS_HANDLERS`)

`observeZfsList(hostId, data, receivedAt)`:

- Pools are matched by `dataset.pool` name among `Pool` rows with that `hostId`;
  datasets of a pool the server has not seen yet are skipped (zpool-status arrives in
  the same run and the next `zfs-list` picks them up).
- Upsert every dataset; `parentId` from the name's parent (`a/b/c` → `a/b`), resolved
  after the batch so order does not matter. `present=true`, `lastSeenAt`.
- Datasets of those pools not in the payload → `present=false` (keep the row and its
  snapshots; a dataset page for a destroyed dataset still renders). Diary
  `dataset-created` (first sight after the pool's first `zfs-list`, i.e. not on the
  very first ingest of a pool) and `dataset-destroyed` on the pool subject, title
  `dataset tank/photos created`.
- `DatasetReading`: insert when no reading exists for the dataset on the same UTC day,
  or when `used` differs from the last reading by more than 1 %. Prune readings older
  than 400 d.
- Whole thing in one `db.transaction`.

`observeZfsSnapshots(hostId, data, receivedAt)`:

- Group by dataset name; resolve dataset rows via `(poolId, name)` for that host's
  pools. Snapshots of unknown datasets are skipped and counted in the returned summary.
- Upsert on `(datasetId, name)`: set `guid` (never overwrite a non-null guid with null),
  `used`, `referenced`, `written`, `lastSeenAt`.
- Delete Snapshot rows of that host's datasets that are absent from the payload. The
  payload is the full list for the host, so absence means destroyed.
- Update `Dataset.snapshotCount` and `latestSnapshotAt` for every dataset of the host
  (including those now at zero).
- No diary events for snapshots; too chatty. Return `{ created, destroyed }` counts for
  the ingest summary.
- One transaction. 1 800 snapshots on mars: batch the upsert with
  `insert ... onConflictDoUpdate` in chunks rather than a query per row.

### Services and API

`server/services/zfs/datasets.ts` also exports:

- `listDatasets(poolId)` → flat rows ordered by name with `depth`, for the tree.
- `getDataset(id)` → row + pool + host + children summary + snapshots (newest first,
  with `ageMs`) + readings (last 90 d) + diary entries for the subject.
- `datasetCounts(poolId)` → `{ datasets, snapshots, latestSnapshotAt }` for the pool
  page and `listPools`.

Routes: `GET /api/pools/:id/datasets`, `GET /api/datasets/:id`. Zod params in
`shared/schemas/datasets.ts`. `PoolSummary` and `PoolDetail` gain `datasetCount`,
`snapshotCount`.

Diary: add `dataset` to `DIARY_SUBJECT_TYPES`; `app/utils/diarySubjects.ts` label
`host · pool/dataset`; the subject picker loads datasets from the pool datasets route.
Dataset subjects link to `/datasets/:id`.

### UI

- Pool page (`app/pages/zfs/[id].vue`): "Datasets" tab, badge = dataset count. Tree
  table (indent by depth, collapsible children client-side) with columns name, type,
  used, referenced, ratio, quota (— when unset), snapshots (count), newest snapshot
  (relative age). Volumes marked with a badge. Rows link to the dataset page. Not
  present datasets shown greyed at the bottom with "destroyed".
- Dataset page `/datasets/:id`: header (name, host · pool, type badge, mountpoint),
  properties panel (used/referenced/available/logical/ratio/quota/refquota/reservation/
  recordsize/compression/encryption/creation), used-over-time chart from readings
  (`TimeSeriesChart`, same as the pool capacity chart), snapshot table (name, created,
  age, used, referenced, written; newest first; paginate at 100), diary section using
  the existing `DiaryTimeline` with subject `dataset`.
- Pool list `/zfs`: no new columns. Home tiles: no change.
- Command palette: datasets by name (`host · pool/dataset`), from a lightweight
  `GET /api/datasets?q=` search route (limit 20).

### Tests

- Parser: guid present and absent.
- Service: fixture-driven (`test/fixtures/mars/zfs-list.json`, `zfs-snapshots.json`
  after seeding a Pool row named `tank`): upsert idempotent; parent resolution; a second
  ingest missing a dataset flips `present`; a second snapshot ingest missing a snapshot
  deletes it and updates counts; reading dedupe per day and the 1 % rule.
- e2e: the two routes and the dataset diary subject.

## Steps

1. Collector `guid` column, README, capture script, 003 table; parser + schema +
   migration.
2. `observeZfsList`, `observeZfsSnapshots`, handlers, diary subject type, tests.
3. Queries, routes, pool counts.
4. Pool tab, dataset page, palette entry, diary subject picker.
5. Update 004 (Phase 9 done) and 003's data model sketch.

## Out of scope

- Snapshot staleness rules ([016](016-Snapshot-staleness.md)), replication pairing
  ([015](015-Replication-health.md)), property audit ([024](024-ZFS-property-audit.md)).
- Bookmarks, clones (`origin`), holds.
- Per-snapshot diary events.

## Findings

(agents append here)
