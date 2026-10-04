---
type: task
status: done
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

Done:

- `isPlaceholderWwn` (`server/services/identity.ts`): an all-zero WWN, or NAA 5 with a
  zero OUI, isn't a key. Neither are the udev names built from it (`ID_SERIAL`
  `3<wwn>`, `scsi-3<wwn>`, `wwn-0x<wwn>`). Behind a placeholder, udev keys on SCSI
  `ID_MODEL` + `ID_SCSI_SERIAL` instead. That matches lsblk's model-serial, because the
  udev payload has no `DEVNAME` and would otherwise create a third, pathless row.
- `absorbBridgedTwins` (`server/services/bridge.ts`) runs after each smartctl sighting.
  A disk on the same host and device path, last seen within `RUN_WINDOW_MS` (15 min),
  with `link = usb`, never seen by smartctl, the same capacity or none, and nothing
  from the user (notes, inventory, override, disposal, replacement, faults) is that
  disk's bridge twin. Its keys, vdevs and diary move across, its `disk-appeared` entry
  is dropped, its usage, link, alias and location fill the gaps, and a `bridge-linked`
  entry records the link. After that, lsblk and udev match the drive directly.
- Linking only on smartctl means a hot-swap can't attach a new disk's bridge keys to
  the old drive: the twin is absorbed by whichever drive smartctl sees at that path in
  the same run. If smartctl arrives before lsblk on the first run, the link happens on
  the next run.
- Migration `0028_placeholder_wwn_keys` deletes stored placeholder keys. Existing
  twins are absorbed on the host's next collector run.
- Fixture `test/fixtures/bugs/usb-bridge` (scrubbed). `bin/scrub-fixtures.py` keeps
  placeholder WWNs and fakes `ID_USB_SERIAL_SHORT`.
