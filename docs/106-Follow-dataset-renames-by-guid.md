---
type: task
status: todo
---

# Follow dataset renames by guid

## Problem

A dataset is identified by pool and name (`Dataset_poolId_name_key`). After a
`zfs rename` (or a rename of a parent, which moves its children with it), the old row is
marked not present with a `dataset-destroyed` event, and the new name becomes a new row
with a `dataset-created` event. Everything keyed on the dataset id is split in two:

- A replication into the old name goes `target-gone` and raises a fault. A second
  replication is discovered for the new name, learning its cadence from scratch.
- Readings, snapshot history and diary entries stay on the old row. The dataset page for
  the new name starts empty.

Seen on a real host: a parent dataset on a replication target pool was renamed one level
deeper, and its child's replication was left as `target-gone`.

## Context

- ZFS gives every dataset a `guid` property. It is unique within a pool and does not
  change across `zfs rename`. Checked on a real host: a received dataset gets its own
  guid, but its snapshots keep the source's snapshot guids.
- The collector does not send it: `zfs_list_columns` in `host/tetanus-collect` (0.8.0)
  and the `zfs-list` capture in `bin/capture-fixtures.sh` both lack `guid`. The `Dataset`
  table has no guid column.
- `observePoolDatasets` in `server/services/zfs/datasets.ts` upserts by name, then marks
  departed names not present and records `destroyed` / `created` events.
- zpool history already records renames (`zfs rename a b` and the internal
  `rename a (id) -> b`), but only the last 500 lines are collected, so it can miss
  one. Children are not listed and have to be derived from the name prefix.
- Replication discovery (`presentTargets` in `server/services/replications/population.ts`)
  matches receive lines to present datasets by name. Receives under the old name then
  match nothing, and receives under the new name match the renamed row.
- Four tables reference `dataset.id`.
- Collector versions: `COLLECTOR_VERSION` and `MIN_COLLECTOR_VERSION` in
  `shared/collector.ts`. An older collector raises `collector-outdated`.

## Plan

- Collector 0.9.0: add `guid` to `zfs_list_columns`; recapture or extend the `zfs-list`
  fixture.
- Schema: nullable `Dataset.guid` text column (it doesn't fit in a JS number; snapshot
  guids are already stored as text). Index on `(poolId, guid)`, not unique, because old
  rows may share a guid with a newer row once a pool is recreated.
- Ingest: parse `guid`. Before the upsert by name, for each observed dataset with a guid,
  look for a row in the same pool with that guid and a different name:
  - If found, rename that row and keep its id, `firstSeenAt` and `present = true`. Record a
    `dataset-renamed` diary event with `from` and `to`, instead of destroyed + created.
  - If a row that is not present already holds the new name (for example, renamed away and
    back), merge it into the renamed row: move its readings, snapshots, diary entries and
    replications onto the renamed row's id, then delete it. Where both rows have a
    replication, keep the renamed row's replication and archive the other.
  - Handle a swap (a → b and b → a in one ingest) by renaming through a temporary name
    inside the transaction.
- Backfill guids on existing rows from the first ingest that includes them. Existing
  rows that are no longer present stay as they are.
- Replications follow the dataset id, so nothing changes in replications beyond a test.
- Diary vocabulary: add `dataset-renamed` in `shared/diary.ts`, with copy along the lines
  of "renamed from a to b".
- Tests:
  - A plain rename keeps the id.
  - A parent rename carries its children.
  - Rename and a new dataset at the old name in the same ingest.
  - A swap.
  - An ingest without guids (older collector) behaves as now.
  - A replication into a renamed target stays `ok` and doesn't fire `target-gone`.
- Update [003](003-Architecture-and-data-model.md) (dataset identity) and
  [015](015-Replication-health.md) (target gone).

### Splits that happened before this

Rows split by an earlier rename have no guid to match on. Archive the stale replication
with a note. Merging two dataset rows by hand is out of scope.
