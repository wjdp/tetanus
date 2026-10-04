---
type: task
status: planned
---

# Dataset quota nearly full

Stub. Sibling of [055 Pool capacity fault](055-Pool-capacity-fault.md) at dataset
level.

## Problem

A dataset with a `quota` or `refquota` can fill up while the pool has plenty of space.
The writer (a backup job, a media server, a VM) fails with ENOSPC and nothing in
tetanus notices. The dataset tree shows `used` and `quota` side by side, but there is
no fault, alert or diary event.

## Context

- `Dataset` stores `used`, `referenced`, `available`, `quota`, `refQuota`,
  `reservation`, `usedBySnapshots`; `DatasetReading` keeps the history. Collected hourly
  by `zfs-list` (`host/tetanus-collect`, column list at the top of the script).
- `available` already accounts for quotas and reservations up the tree, so "nearly
  full" for a dataset is a function of `available` against `used`, not just `quota`.
- Datasets without a quota inherit the pool's capacity question, which 055 covers;
  this task is only datasets whose ceiling is lower than the pool's.
- Dataset faults do not exist yet; `Fault.subjectType` has `disk`, `pool`, `host` and
  replication subjects. The dataset page and tree would need somewhere to show one.
- Zvols with `volsize` are the same shape again (a VM disk filling up) and may or may
  not belong here.

## Questions

1. Is this worth a fault subject of its own, or is a dataset fault surfaced on its pool?
2. Zvols in scope?
