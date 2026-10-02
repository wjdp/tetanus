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
