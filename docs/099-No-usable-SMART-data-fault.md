---
type: task
status: done
---

# No usable SMART data fault

From [085](085-Disk-fault-coverage.md). Decisions taken 2026-10-06.

## Problem

A disk can report to tetanus without giving any usable SMART data: SMART unsupported or
disabled, or the command failing behind a USB bridge with no passthrough. `smartSupport
{ available, enabled }` and the `commandFailed` exit bit are parsed
(`server/ingest/smartctl-xall.ts`) and read by nothing. Such a disk shows no faults and
looks healthy when it is only unmonitored.

## Design

- New kind `smart-unavailable`: category disk, subject disk, severity warning, lifetime
  persistent, actions acknowledge, accept, clear.
- Raised for an in-service disk when its latest reading is not standby and any of:
  - `smartSupport.available` is false
  - `smartSupport.enabled` is false
  - the reading has no attributes, no NVMe log and no SCSI counters, and `commandFailed`
    is set
- Data carries the reason. Titles: "SMART is not supported", "SMART is disabled",
  "SMART data could not be read".
- The "could not be read" reason adds one sentence on the likely cause: "Often a USB
  bridge that needs a smartctl device type." No action is offered until
  [073](073-Collector-device-exclusion-and-type-override.md) provides one; 073 then
  replaces the sentence with a link to the override. The other two reasons get no hint.
- Resolves when a reading arrives with usable data. Accepting covers a known bridge for
  good; the reason changing reopens it.
- Standby readings never raise it (`standby` is already separated at ingest).
- Disk status for these disks stays `unknown`; the fault is what makes it visible in
  counts and alerts.

## Work

1. Kind definition and detector.
2. `faultsBackfill.ts` entry.
3. The disabled case can name the fix (`smartctl -s on`) in the fault's description.
4. Simulator scenario; tests for each reason and for standby.

## Questions

1. Does a bridge that returns identity but no attributes set `commandFailed`
   reliably? Check the USB fixtures ([078](078-USB-bridge-splits-a-disk-into-two-records.md)).
2. Suggest the device-type override in the fault copy? Answered 2026-10-06: a generic
   hint now, the link when 073 lands. See Design.

## Known limit

The collector skips a device whose smartctl output is empty and never posts it
(`host/tetanus-collect`, "skipped, no output"). A bridge that returns nothing at all
never reaches the server, so this fault can't cover it; it catches only disks that
return identity without SMART data. Posting a "tried, got nothing" record is a collector
change and belongs to 073.
