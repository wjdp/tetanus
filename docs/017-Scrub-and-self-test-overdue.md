---
type: task
status: planned
---

# Scrub and self-test overdue

Stub. Alert when a pool has not been scrubbed, or a disk has not run a long SMART
self-test, within a configurable interval. Extends Phase 8 rules
([004](004-Project-plan.md)).

The pool half is done: `scrub-overdue` landed with
[046](046-ZFS-fault-coverage.md) (`Pool.lastScrub`, per-pool `scrubIntervalDays`
default 35 d, 0 disables, set from the pool page). The self-test half below is still
planned.

## Sketch

- Pool: done in [046](046-ZFS-fault-coverage.md).
- Disk: newest `SelfTest` of type long/extended; threshold default 35 d; skip disks
  not in `in-use`/`spare`.
- Alert rule with recovery; diary `self-test-overdue` once on entry.
- Surface: disk page self-tests section, inventory column "last long test".

## Unanswered questions

1. Does the author run long self-tests at all on mars, or is this scrub-only for now?

## Never run (added 2026-10-04)

The self-test half also covers disks with no long self-test at all. Many home users
never schedule one; SMART attributes only reflect sectors that have been read, so an
untested disk with years of power-on time can look clean. `SelfTest` rows come from
`smartctl --xall` (log of past tests); a disk with none is a stronger signal than an
old one. Not a disk fault in the sense of "failing", but an unanswered question about
the disk.
