---
type: task
status: planned
---

# Merge and split disk records

Stub. When identity matching gets it wrong, the user has no way to fix it.

## Problem

Matching ([003](003-Architecture-and-data-model.md) §Identity) is any-key: WWN,
model-serial, udev-serial, by-id. When keys point at two different disks, tetanus
refuses to merge and raises `identity-conflict` (`server/services/disks.ts`). The user
can acknowledge that fault, but can't resolve it: there's no way to say "these two
rows are one disk", and no way to undo a wrong automatic merge (two disks sharing a
key, e.g. a bridge or controller reporting one WWN for every drive).

Duplicate and ghost devices are scrutiny's second most common complaint (about 19
issue titles across AnalogJ and Starosdev, e.g. AnalogJ#157 where standby drives
created duplicates). Scrutiny's only answer is an API-only `merge_into` endpoint.

## Context

- [056 Manual disk creation](056-Manual-disk-creation.md) creates the need directly: a
  hand-entered disk that a collector later sees for the first time becomes a second
  row unless the two can be joined.
- Every disk-scoped table points at `Disk.id`: readings, attributes, self-tests,
  diary, faults, acceptances, acknowledgements, inventory, vdev membership. A merge
  re-parents all of them; a split has to decide which rows go where.
- The longer this waits, the more tables a merge has to touch.
- Diary entries for the merge or split itself.

## Questions

1. Merge only, or split as well? A split needs a rule for history recorded after the
   wrong merge.
2. When inventory fields conflict (both rows have an alias or a purchase date), who
   wins?
