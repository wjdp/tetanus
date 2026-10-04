---
type: task
status: todo
---

# USB bridge splits a disk into two records

A SATA disk in a USB enclosure on a non-ZFS host shows as **spare**, even though it has
a mounted ext4 filesystem. The cause is that tetanus has stored it as two `Disk` rows:
one row holds the SMART data and the other holds the usage.

## Problem

The USB bridge gives lsblk and udev a different identity from the one smartctl sees
through it (`-d sat`):

| Source | WWN | model / serial |
|---|---|---|
| smartctl `-d sat` | the drive's real WWN | real model / real serial |
| lsblk, udev | `5000000000000001` | bridge-mangled model (`EFRX-68N32N0`) / bridge serial |

udev `by-id` names are bridge-derived too (`usb-…`, `scsi-3500…01`, `wwn-0x500…01`).

The two sets of keys share nothing, so `matchKeys` (`server/services/disks.ts`) creates
a second disk for the lsblk/udev sighting. Usage comes only from lsblk
(`observeLsblk` → `recordUsage`), so the mount lands on the phantom row. The real row
has no `latestUsage`, so `inferState` returns `spare`. The phantom row has no SMART
data and shows as a separate in-use disk.

The two sightings come from the same host, have the same device path (`/dev/sda`) and
arrive within the same second of one collector run.

### Placeholder WWN

`5000000000000001` is a generic placeholder that the bridge firmware reports, not an
identity. `wwnKey` (`server/services/identity.ts`) accepts it as a key, so a second
drive behind the same kind of bridge would match on it and get merged into the same
row. That's the wrong-merge case [069](069-Merge-and-split-disk-records.md) describes.

## Fix

- Reject placeholder WWNs as keys: a NAA-5 value with a zero OUI and a tiny serial,
  e.g. `5000000000000001`. Optionally, also reject any WWN that is already held by a
  disk with a different model-serial.
- Link sightings by device path: when a smartctl sighting and an lsblk/udev sighting on
  the same host share a device path within one collector run, they're the same disk.
  smartctl's identity wins, and the lsblk/udev keys are attached to that disk. This has
  to work in either payload order. Today lsblk arrives first and creates the phantom.
- Clean up existing phantoms: migrate their keys and usage onto the smartctl disk, then
  delete the phantom row. Either do this as a one-off repair, or depend on
  [069](069-Merge-and-split-disk-records.md).
- Fixture: capture lsblk, udev and `smartctl -x -d sat` output from a USB-bridged disk.
  Use placeholder serials and WWNs.

## Open questions

- Is device-path linking safe across a hot-swap mid-run? Should it require that both
  sightings come from the same `CollectorRun`?
- Should the bridge's `usb-…` by-id names stay as keys once they're linked? They're
  stable for that bridge, so they're useful when smartctl can't see through it.
