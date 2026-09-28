---
type: task
status: planned
---

# Replication health

Know that a dataset on one host is replicated to another, and whether the copy is
current. Extends Phase 9 ([004](004-Project-plan.md)); needs `Dataset` and `Snapshot`
from that phase. Design context in [003](003-Architecture-and-data-model.md).

## Why

The backup of a pool is only as good as its last received snapshot. Nothing today tells
the author that `tank/photos` on mars stopped arriving on the second host three weeks
ago. tetanus already has every snapshot on every host; pairing them is cheap.

## Contract

### Pairing, zero config

A snapshot's `guid` property survives `zfs send | zfs recv`. Two datasets on different
hosts (or the same host) that share a snapshot GUID are a replication pair. Direction
is inferred: the dataset whose snapshots have the earlier `creation`, or that has
snapshots the other lacks at the newest end, is the source. Ambiguous pairs (identical
sets) are shown as "in sync, direction unknown"; a manual direction override lives on
the pair.

Collector change: add `guid` to the `zfs-snapshots` columns. Add a `zfs-get` source
per host: `zfs get -Hp -t filesystem,volume -o name,property,value
receive_resume_token,keystatus,readonly,encryption` (extend the property list as
needed; the parser is generic).

Schema: `Snapshot.guid` (indexed), `ReplicationPair` (`id`, `sourceDatasetId`,
`targetDatasetId`, `direction (inferred|manual)`, `firstSeenAt`, `lastSeenAt`,
`lagThresholdHours?`, `muted`). Dataset gains `receiveResumeToken?`, `keyStatus?`,
`readonly?`, `encryption?`.

### Derived per pair, computed on read

- **Latest common snapshot** and its age.
- **Lag**: age of the newest source snapshot the target does not have. Zero when the
  newest source snapshot is present on the target.
- **Divergence**: the target has snapshots newer than the latest common one that the
  source lacks. Someone wrote to the target, or the next receive needs `-F`.
- **Interrupted receive**: `receive_resume_token` set on the target.
- **Key not loaded**: `keystatus = unavailable` on either side.
- **Target writable**: `readonly = off` on the target (warning, not fault).

Pair health = worst of: `ok`, `lagging` (lag > threshold, default 48 h, per-pair
override), `diverged`, `interrupted`, `stale` (no snapshot in common for > 30 d, or
either dataset gone).

### Diary and alerts

Auto events on the target dataset: `replication-paired` (first sighting),
`replication-lagging` on entering lag, `replication-caught-up` on leaving it,
`replication-diverged`, `replication-interrupted`. Alert rules ([004](004-Project-plan.md)
Phase 8): pair enters `lagging`/`diverged`/`interrupted`; recovery notice on return to
`ok`. Dedupe on `(rule, pairId)`.

### API and UI

`GET /api/replication` → pairs with both endpoints (host, dataset), health, lag, latest
common snapshot, counts. `PATCH /api/replication/:id` → direction, threshold, muted.

**Backups** page (sidebar entry): one row per pair, grouped by source host. Columns:
source, target, health, lag, last common snapshot, snapshots behind. Row expands to the
snapshot ladder: two columns, source and target, common ones joined. Dataset page shows
its pairs; the pool page shows a count of lagging pairs; the home page header carries a
chip when any pair is not `ok`.

### Non-ZFS backups

Same seam: `POST /api/ingest/job-report?name=<job>&ok=0|1` with a free-text log body.
Stored as `JobReport` (`hostId`, `name`, `at`, `ok`, `bytes?`, `log`). Listed on the
Backups page below the ZFS pairs; alert when a job that used to report goes silent
longer than its observed interval × 2, or reports `ok=0`. restic/borg/rsync scripts
curl it at the end. Optional; the ZFS pairing is the point.

## Out of scope

- Driving syncoid/zrepl. Read-only, as everything in v1.
- Bookmarks (`zfs list -t bookmark`): a source that prunes snapshots and keeps
  bookmarks still shows the right lag from the target's newest GUID; add bookmarks
  later if a real pair needs them.
- Off-host targets tetanus cannot see (rsync.net, a friend's NAS). The job-report route
  is the fallback.

## Steps

1. Add `guid` to `zfs-snapshots`, `Snapshot.guid`, backfill on next ingest.
2. `zfs-get` source, parser, `Dataset` columns, collector line.
3. `replication` service: pairing, health derivation, pure and tested against a
   fixture built from two hosts' snapshot lists (capture from mars and the target host
   with `bin/capture-fixtures.sh`).
4. Diary events and alert rules.
5. API, Backups page, dataset page section, home chip.
6. `job-report` ingest and listing.

## Unanswered questions

1. Is there a second host to capture from yet, or does step 3 need a synthetic fixture?
2. Snapshot cadence is 6 h; is that fine-grained enough for lag, or should the collector
   send snapshots more often once `guid` makes the pairing useful?
3. Should a dataset with no pair at all be flagged ("not backed up") on the Backups
   page, opt-out per dataset?

## Findings

(agents append here)
