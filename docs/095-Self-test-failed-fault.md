---
type: task
status: todo
---

# Self-test failed fault

From [085](085-Disk-fault-coverage.md), gap 2. Decisions taken 2026-10-06.

## Problem

A failed SMART self-test raises nothing, even a failed long test. `SelfTest` rows are
stored (`type`, `status`, `passed`, `lifetimeHours`, `lba`) and shown on the disk page,
and smartctl's exit bit 7 (`selfTestLogHasErrors`) is parsed, but no detector reads
either. smartd alerts on this by default (`-l selftest`).

## Design

- New kind `self-test-failed`: category disk, subject disk, severity error, lifetime
  persistent, actions acknowledge, accept, clear.
- Source is the `SelfTest` rows, not exit bit 7: the bit is ATA-centric and says nothing
  about which test failed. NVMe and SCSI self-test logs go through the same rows.
- A test counts as failed when it completed with a failure: read failure, electrical,
  servo, unknown failure or handling damage. Aborted by host, interrupted by reset and
  in progress are not failures. Check that `passed` is derived this way at ingest for
  all three protocols, and fix it there if not.
- One fault per disk, keyed on the disk id, for the newest failed test not yet
  superseded. Data: type, status, lifetime hours, failing LBA.
- Resolves when a later test of the same or a longer type passes. A passed long test
  resolves a failed short or long test; a passed short test resolves only a failed
  short. Conveyance and selective tests rank with short.
- "Later" compares `seenAt`, then `lifetimeHours`. `lifetimeHours` alone is unsafe: it
  is 16-bit on ATA and wraps at 65,536 h ([081](081-Power-on-hours-counter-wraparound.md)).
- Reopens after accept or acknowledge when a newer failed test appears.
- Title: "Long self-test failed: read failure at LBA n".

## Work

1. Kind definition in `shared/faults.ts`; detector beside `detectSmartAttributes` in
   `server/services/faults.ts`.
2. `faultsBackfill.ts` entry so disks with a failed test already on record get the fault.
3. Simulator scenario ([044](044-Fault-simulator.md)): failed short, failed long, then a
   passing long.
4. Alert rule and diary line follow from the fault; check the alert copy.
5. Tests: type ranking, hours wraparound, aborted tests ignored.

## Questions

1. Does a failed test with no LBA (electrical, servo) deserve different copy or the
   same fault?
