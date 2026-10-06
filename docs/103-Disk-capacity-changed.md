---
type: task
status: in-progress
---

# Disk capacity changed

## Problem

A disk's reported capacity can change while its identity stays the same.
`observeDiskFromSmartctl` (`server/services/disks.ts`) writes the new `capacityBytes`
over the old one. No diary entry is written, the previous value is not kept, and
nothing is raised. Every view then shows the new size as if the disk had always been
that size.

Causes, roughly from most to least likely:

- A USB bridge or enclosure reporting a different size from the bare disk
  ([078](078-USB-bridge-splits-a-disk-into-two-records.md)).
- A host protected area or DCO/AMA limit set or removed.
- A reformat to a different logical sector size or with a changed LBA count.
- Head depopulation (`REMOVE ELEMENT AND TRUNCATE`), which removes a failing head and
  shrinks the disk permanently.

## Observed case (2026-10-06)

A 16 TB helium SATA disk with one failing head had that head depopulated with
openSeaChest. The format took about 17 hours; the collector was stopped on that host
for the duration, so there is a one-day gap in readings. The disk came back at 15 TB.

What tetanus did:

- Matched the disk to its existing record by WWN and serial. Capacity is not part of
  any disk key, so there was no duplicate disk and no identity conflict.
- Stored the new capacity from smartctl `user_capacity` on the first reading after the
  format. All views (overview, inventory, topology, host totals, price per TB) read the
  live value and show 15 TB.
- Kept the matched drive spec at 16 TB, which is right for a nominal figure. Nothing
  compares it with the actual size.
- Wrote no diary entry for the change. The only record is a manual one.

Other things seen in the same event. They are recorded here for context and are not
part of this task:

- The depopulation reset the SMART defect counters (reallocated, pending,
  uncorrectable, reported uncorrectable, command timeout) to zero. tetanus logged each
  attribute as passed, changed the disk status from failed to passed, and sent a "Disk
  recovered" notification. A defect counter falling to zero is treated as recovery, not
  as a reset.
- SMART then read clean while the FARM per-head reallocation counts were non-zero on
  three of the remaining heads, and the FARM unrecoverable read count kept its
  pre-format value. The per-head values are displayed and not evaluated.
- SMART power-on hours jumped forward by about 21,000 hours between consecutive
  readings, to match the FARM figure, and the power cycle count rose by about 100.
  Nothing flagged the discontinuity. Before the format the disk met the
  `smart-counters-reset` condition (FARM hours well above SMART hours), but the fault
  was never raised because the disk was in a history state. After the format the two
  agree, so it never will be. See also
  [081](081-Power-on-hours-counter-wraparound.md).
- FARM still reports the original head count and `depopulation_head_mask: 0` after the
  depopulation, so the collected data does not show that a head was removed.
  ([083](083-Seagate-FARM-log.md))
- The SMART self-test log was cleared by the format.

Depopulation is rare enough that these are not worth handling for its sake. A counter
reset to zero could have other causes (firmware update, some secure erase paths) and
may deserve its own task if it turns up again.

## Design

- When an authoritative identity observation carries a `capacityBytes` that differs
  from a non-null stored value, write an auto diary entry `capacity-changed` on the
  disk with `{ from, to }` in bytes. Title: "capacity changed from 16.0 TB to 15.0 TB".
  Then store the new value as now.
- Identity hints (lsblk `sizeBytes`) only fill a missing value today and stay that way.
  They never trigger the entry.
- First observation (stored value null) is not a change.
- A difference under 0.1 % of the stored value is not a change: the new value is stored
  and no entry is written. This absorbs a bridge or controller reserving a few sectors;
  HPA, DCO, reformat and depopulation changes are all far larger.
- New fault kind `capacity-changed`: category disk, subject disk, severity warning,
  lifetime `until-acknowledged`, action acknowledge. Modelled on `identity-conflict`:
  raised from the diary entry, cleared only by acknowledgement, and a later change
  opens a new fault.
- Fault data carries `from` and `to`. Title: "Capacity changed from 16.0 TB to
  15.0 TB". The description lists the usual causes from the Problem section.
- Raised whatever the disk's state, including history states: a disk on the bench is
  where a reformat or depopulation happens.
- No alert rule beyond what faults already get.
- The previous capacity is not kept on the disk row. The diary entry and the fault data
  are the record.
- Separately from any observed change, the disk page shows when a disk is smaller than
  its model's nominal size. When the matched drive spec has a `capacityTb` and the
  actual capacity is more than 2 % below it, the capacity fact reads "15.0 TB (nominal
  16 TB)". No fault and no diary entry; it is a property of the disk, and it covers a
  disk that was already short when tetanus first saw it.

## Work

1. Diary entry in the smartctl identity path, with tests for change, no change, first
   observation and hint-only observation.
2. Kind definition, detector and vocabulary.
3. Nominal-size note on the disk page capacity fact.
4. Simulator scenario that shrinks a disk.

## Questions

1. Do smartctl `user_capacity` and lsblk size ever disagree for the same disk on the
   same host? Checked 2026-10-06 against a real fleet: 26 disks over 4 hosts, all
   identical to the byte. Not known for USB bridges specifically. lsblk only fills a
   missing value, so a disagreement could not make the entry flap in any case.
2. Ignore small differences? Answered 2026-10-06: yes, under 0.1 %. See Design.
3. Keep the previous capacity on the disk row? Answered 2026-10-06: no, the diary entry
   is enough.
4. Show actual capacity below nominal on the disk page? Answered 2026-10-06: yes. See
   Design.
