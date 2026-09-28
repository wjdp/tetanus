---
type: task
status: planned
---

# Snapshot staleness

Stub. Flag datasets whose newest snapshot is older than expected, or that have no
snapshot at all. After Phase 9 ([004](004-Project-plan.md)); sibling of
[015](015-Replication-health.md).

## Sketch

- Per dataset: age of newest snapshot from `Snapshot.creation`. Threshold default 36 h,
  overridable per dataset; per-dataset "no snapshots expected" opt-out.
- Optional: ship `/etc/sanoid/sanoid.conf` as a source and check retention counts
  (hourly/daily/monthly present as configured).
- Alert rule: dataset enters stale; recovery when a new snapshot lands. Diary events
  on the dataset.
- Surface: dataset tree column, Backups page section, home header chip.

## Unanswered questions

1. Threshold per dataset, or inherit down the dataset tree like ZFS properties?
2. Is sanoid the only snapshot tool worth parsing config for?
