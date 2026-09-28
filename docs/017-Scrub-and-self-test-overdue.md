---
type: task
status: planned
---

# Scrub and self-test overdue

Stub. Alert when a pool has not been scrubbed, or a disk has not run a long SMART
self-test, within a configurable interval. Extends Phase 8 rules
([004](004-Project-plan.md)).

## Sketch

- Pool: `Pool.scan.endTime` for the last finished scrub; scrub history once stored
  (013 findings: only the current scan is kept today). Default threshold 35 d
  (monthly scrub plus slack); per-pool override; muted for pools that are exported
  or read-only by design.
- Disk: newest `SelfTest` of type long/extended; threshold default 35 d; skip disks
  not in `in-use`/`spare`.
- Alert rule with recovery; diary `scrub-overdue` / `self-test-overdue` once on entry.
- Surface: pool page scan panel, disk page self-tests section, inventory column
  "last long test".

## Unanswered questions

1. Does the author run long self-tests at all on mars, or is this scrub-only for now?
