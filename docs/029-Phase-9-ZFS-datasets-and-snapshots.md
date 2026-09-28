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

### Persistence

Steps 1–2 done. Exports for steps 3–4:

- `server/services/zfs.ts` re-exports `observeZfsList(hostId, ZfsListResult, receivedAt)`
  and `observeZfsSnapshots(hostId, ZfsSnapshotsResult, receivedAt)`, both returning
  `DatasetIngestSummary { created, destroyed, skipped }`, and the row types `DatasetRow`,
  `DatasetReadingRow`, `SnapshotRow` (`$inferSelect` of `dataset`, `datasetReading`,
  `snapshot` in `server/database/schema.ts`). Queries belong in
  `server/services/zfs/datasets.ts`.
- `Dataset.used`, `referenced`, `available`, `creation` are not null; every other
  property is nullable (volumes have no `recordsize`, `mountpoint` `-` → `null`).
  `mountpoint` keeps `legacy`/`none` verbatim. `Snapshot.used/referenced/written/creation`
  not null. Unique indexes are named `*_key` like the existing ones.

Decisions and deviations:

- Parser keeps a guid exact by quoting `"guid": {"value": <digits>` in the raw body
  before `JSON.parse` (same trick as `zpool-status`); a guid that reaches the parser as
  an unsafe number or non-digits is a `ParseError`.
- Datasets are marked absent only for pools that appear in the payload, so an exported
  pool does not flood the diary with `dataset-destroyed`. A pool name shared by two
  `Pool` rows on the host resolves to the most recently seen.
- A previously destroyed dataset that reappears gets `dataset-created` again.
- The handler return value is dropped: `IngestHandler` returns `void`, so
  `{ created, destroyed }` does not reach the ingest summary (still the parser's
  counts). Wiring it needs `IngestHandler` to return a summary; not done.
- Both observers wrap their work in `db.transaction`; under `recordIngest` that nests as a
  savepoint.
- `host/test/stub.sh` maps the new snapshot argv to the old fixture until mars is
  re-captured; drop that case after the re-capture. `host/README.md` shows the
  `zfs list` command as `…`, so it needed no change. Collector is 0.1.1.
- `server/database/migrate.test.ts` updated (migration count, table list). `test/db.ts`
  does not list the new tables; `Pool` cascades clear them.
- `shellcheck` is not installed here; the collector change was not shellchecked.
- `app/utils/diarySubjects.ts` has a `default` branch, so adding `dataset` needed no app
  change.

### Queries and routes

Step 3 done. Services in `server/services/zfs/datasets.ts`, re-exported from
`server/services/zfs.ts` with their types (`DatasetSummary`, `DatasetDetail`,
`DatasetChild`, `DatasetSnapshot`, `DatasetCounts`, `DatasetSearchResult`). Dates are ISO
strings over JSON. `Dataset` below is every `Dataset` column: `id, poolId, name,
parentId, type, mountpoint, used, referenced, available, logicalUsed, compressRatio,
usedBySnapshots, usedByDataset, usedByChildren, quota, refQuota, reservation,
recordSize, compression, encryption, creation, present, firstSeenAt, lastSeenAt,
latestSnapshotAt, snapshotCount`.

`GET /api/pools` and `GET /api/pools/:id` gain, per pool, counting present datasets only:

```
datasetCount: number, snapshotCount: number
```

`GET /api/pools/:id/datasets` (404 for an unknown pool):

```
{ datasets: (Dataset & { depth: number })[] }
```

Present datasets first, then destroyed ones; each group in depth-first tree order (a
parent is followed directly by its descendants). `depth` is the number of `/` in `name`.

`GET /api/datasets/:id` (404 when missing; destroyed datasets still resolve):

```
Dataset & {
  depth: number,
  pool: { id, name, guid },
  host: { id, name, displayName },
  children: { id, name, used, present }[],          present first, tree order
  snapshots: (Snapshot & { ageMs: number })[],      all, newest first
  readings: DatasetReading[],                        last 90 d, ascending
  diary: DiaryEntry[]                                subject dataset, newest first, 100
}
```

`Snapshot` is `id, datasetId, name, guid, used, referenced, written, creation,
lastSeenAt`; `DatasetReading` is `id, datasetId, at, used, referenced, available,
usedBySnapshots`.

`GET /api/datasets?q=` (`q` trimmed, 1–100 chars, else 400):

```
{ datasets: { id, name, pool: { id, name }, host: { id, name, displayName } }[] }
```

Case-insensitive substring match on the full name, present only, ordered by name,
at most 20. `%`, `_` and `\` in `q` match literally.

Decisions and deviations:

- Tree order is computed in JS by comparing `/`-separated segments: SQLite's byte order
  puts `tank/a-b` between `tank/a` and `tank/a/c`.
- `listDatasets` throws 404 for an unknown pool rather than returning `[]`, so the route
  can 404.
- `datasetCountsByPool(poolIds)` is also exported from `datasets.ts` (one grouped query,
  used by `listPools`/`getPool`); `datasetCounts(poolId)` wraps it.
- The diary service does not check subject existence per type, so `dataset` needed no
  server change; `POST /api/diary` and `GET /api/diary?subjectType=dataset` work as is.
- Existing pool tests use `toMatchObject`, so none needed updating for the new fields.
