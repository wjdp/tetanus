---
type: task
status: planned
---

# ZFS signals on the disk

From [085](085-Disk-fault-coverage.md). Decisions taken 2026-10-06.

## Problem

Two ZFS facts say something about a disk and are missing from the disk's own view:

- `leaf-errors` and `leaf-slow` ([046](046-ZFS-fault-coverage.md)) are pool-subject
  faults. A disk with ZFS checksum errors and clean SMART is the classic sign of a bad
  cable, controller or memory, yet the disk page, the disk list verdict and the planned
  risk level ([086](086-Disk-risk-level.md)) don't see the fault.
- An SMR drive in a vdev resilvers slowly and can be dropped during a resilver. 086
  lists it as a reason, but nothing computes it.

## Design

### Device faults on the disk

- The faults stay pool-subject: one fault, one alert, pool-page grouping unchanged.
- The fault's data gains the disk id of the leaf where the leaf resolves to a disk.
  Group-level errors (mirror or raidz, not attributed to one device) carry none.
- `pool-degraded` is included: where it lists a faulted, degraded or removed device
  that resolves to a disk, it shows on that disk too.
- The link is to the disk the leaf resolved to when the fault was raised. If the disk
  is later replaced in the vdev, the fault stays in the old disk's history and is not
  moved to the replacement.
- The disk page lists live pool faults that name the disk, linking to the pool. The
  disk list verdict and 086's risk read them as inputs.
- Disk status (`latestStatus`) is unchanged: it stays the SMART verdict.

### SMR in a vdev

- A note ([084](084-Statistics-tab.md)), not a fault: "SMR drive in a raidz vdev:
  resilvers will be slow".
- Recording technology comes from `recordingTech` (`shared/hardware.ts`: zoned model,
  model family suffix, drive database, user override). Raise only when it is `smr` and
  not inferred, or the user has confirmed it.
- Applies to raidz and mirror members; not to single-disk pools or non-ZFS disks.

## Work

1. Add `diskId` to `leafData` in `server/services/poolFaults.ts` and disk ids to the
   devices in `pool-degraded` data; backfill live faults.
2. Query for live faults naming a disk; `DiskDetail` field; disk page section.
3. Disk list verdict input.
4. SMR note rule in `server/services/diskNotes.ts`.
5. Tests: leaf with no disk match, disk replaced while the fault is open.

## Progress (2026-10-06)

Built: device faults on the disk. The disk id was already in the fault data; the link is
now pinned to the disk the leaf first resolved to, `/api/faults` takes `namesDisk`, and
the disk page lists live pool faults naming the disk. `vdev-unredundant` also carries a
disk id but is not listed. Still to do: the SMR note (needs 084's notes tier) and the
disk list verdict input (needs [086](086-Disk-risk-level.md)).
