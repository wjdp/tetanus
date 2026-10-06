---
type: task
status: todo
---

# Error log growth fault

From [085](085-Disk-fault-coverage.md), gap 4. Answers question 1 of
[074](074-SMART-error-log.md). Decisions taken 2026-10-06.

## Problem

New entries in a drive's error log raise nothing. Only the exit bit `errorLogHasErrors`
is parsed, and it stays set for the life of the drive once one error is logged, so it
can't signal growth. smartd alerts on a rising count by default (`-l error`).

## Design

- New kind `error-log-growth`: category disk, subject disk, severity warning, lifetime
  until-resolved, actions acknowledge, accept, clear, resolve.
- It does not clear by itself after a quiet period. The user acknowledges, accepts or
  resolves it. It reopens when the count rises above the acknowledged or accepted count,
  as `leaf-errors` does with `acknowledgedCounts`.
- **ATA only.** Source is the device error count in `ata_smart_error_log` (extended
  log, else summary), parsed at ingest and stored per reading. The ATA log records only
  commands that failed on the device (UNC, IDNF, ABRT, ICRC).
- **NVMe is excluded for now** and `num_err_log_entries` stays display only. The count
  mixes host protocol errors with real ones. In the fleet database (2026-10-06), of
  three NVMe drives, two carry static counts in the hundreds with zero media errors:
  one has no readable entries, the other's only entry is "Invalid Field in Command" on
  the admin queue, a host probe the drive doesn't support. Real NVMe media failures
  already fault through `media_errors` and the critical warning.
- Raised when the count is higher than at the previous reading. A first reading with a
  non-zero count sets the baseline and raises nothing.
- A count that falls is a reset, not a recovery: re-baseline, keep any open fault.
- **Folds into a defect fault.** When the disk has a live `smart-attribute` fault on a
  defect attribute, or one is raised by the same reading, the rise is an escalation of
  that fault, not a second one: it is recorded in that fault's data, shown in its title
  ("…, error log +n"), and reopens it if it was acknowledged or accepted. No
  `error-log-growth` fault is opened for that rise.
- Data: count, rise, previous count, time of first rise. Title: "Error log grew by n
  (m total)".
- The entries themselves (command, LBA, power-on hour) are 074's job. When 074 lands,
  the fault links to the log view.

## Work

1. Parse and store the count; it needs history, so a column on the reading or an
   attribute row.
2. Kind definition and detector with `reopen`.
3. No backfill: there's no stored history of the count to compare.
4. Simulator scenario; tests for baseline, rise, reset, reopen after accept, and
   folding into a defect fault.

## Questions

1. Does NVMe need a floor? Answered 2026-10-06: NVMe is excluded, see Design. If it
   comes back, count only new readable entries that are not admin-queue invalid-field
   or invalid-opcode errors.
2. Fold a rise into a concurrent defect fault? Answered 2026-10-06: yes, see Design.
