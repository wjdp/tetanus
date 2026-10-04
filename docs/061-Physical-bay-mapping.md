---
type: task
status: todo
---

# Physical bay mapping

When a disk fails, the next question is which bay it is in. tetanus knows the alias and
`/dev/sdX`, but not where the disk physically sits.

## Problem

Aliases name disks, not bays. `vdev_id.conf` on mars aliases by WWN, so `K3` follows
the disk wherever it goes, and alias order does not match physical order (`Q4` is in
bay 11, `Q3` in bay 12). The host can tell us where each disk is connected: a port, a
phy, and sometimes an SES enclosure slot. It cannot tell us what the user calls that
place ("Bay 3", "top row, left"). tetanus should store the physical location, let the
user label it once per host, and show the label wherever someone needs to pull a disk.

## Context

### What mars has

JMCD 12S4 case: three passive 4-bay backplanes (bays 1–12, left to right, one row per
backplane). An LSI HBA connects to an Intel RES2SV240 expander card over two uplinks.
The expander's next three ports feed the backplanes, and its last port feeds a SAS to
SATA breakout to the metadata SSDs (custom mount, no bays). Onboard SATA carries
`Z3`–`Z5` and one unaliased SSD. NVMe is on PCIe.

- The SES device is the expander (`lsscsi`: `enclosu Intel RES2SV240`), not the
  backplanes. `/sys/class/enclosure/8:0:0:0` reports 24 slots, `ArrayDevice00`–`17`
  (hex), where slot N is expander phy N.
  - Slots 0–7 are the HBA uplinks. They show as "not installed" and give the HBA's
    SAS address as the attached address.
  - Slots 8–19 are the backplanes, holding disks K1–Q3. Slots 20–22 hold M1–M3 on the
    breakout. Slot 23 is empty.
- **Locate works through the passive backplanes.** Writing `1` to
  `ArrayDevice08/locate` lit bay 1, and `ArrayDevice09` lit bay 2. Bay is probably
  slot − 7 for slots 8–19, but that is wiring, not something the host reports.
- `zpool status` JSON has no `vdev_enc_sysfs_path` on mars. `zpool status -c
  enc,slot` prints the enclosure and slot, but only because the script reads sysfs
  itself.
- `enclosure/id` is the enclosure's logical identifier; on mars it equals the
  expander SAS address in `ID_PATH` (`exp0x…`). It is stable across reboots, unlike
  the `8:0:0:0` SCSI address, which can change.

### Address sources

| Disk attachment | Address source | Example |
|---|---|---|
| Behind SES (expander or backplane) | `/sys/class/enclosure` slot | enclosure id + slot 8 |
| SAS expander, no SES | udev `ID_PATH` | `pci-0000:26:00.0-sas-exp0x…-phy8-lun-0` |
| HBA direct | udev `ID_PATH` | `pci-…-sas-phy5-lun-0` |
| Onboard SATA | udev `ID_PATH` | `pci-0000:06:00.1-ata-5.0` |
| NVMe | udev `ID_PATH` | `pci-0000:01:00.0-nvme-1` |
| USB | udev `ID_PATH` | `pci-…-usb-0:3:1.0-scsi-0:0:0:0` |

- `ID_PATH` is already collected and parsed (`server/ingest/udev.ts` keeps every `E:`
  line) but not stored. It is stable for a given port, and it changes when a disk
  moves, which is exactly what makes it a usable key.
- systemd 251+ writes ATA paths as `ata-5.0` and keeps the old form in
  `ID_PATH_ATA_COMPAT` (`ata-5`). Older hosts write only `ata-5`. Both forms are in the
  mars fixtures (`udev/b65-0.txt`) and the demo (`server/demo/smartDevices.ts`).
- A new PCIe card or a BIOS change can renumber PCI addresses, which changes every
  `ID_PATH` on the host at once.
- On real SES backplanes (e.g. Supermicro BPN-SAS3-*EL) the slot is the bay and slot ≠
  phy. Slot element names vary (`ArrayDevice08`, `Slot 01`, `Disk001`), and some
  contain spaces.
- `vdev_id.conf` can name bays itself (`topology sas_direct|sas_switch`, `channel`,
  `slot phy|ses`; see vdev_id.conf(5)). Users who configure it that way already have
  bay names as aliases. Reading it as a bay map is out of scope.
- [064 Disk identify light](064-Disk-identify-light.md) writes the same
  `locate` file this task reads.

## Design

### Collector (done)

Collector 0.5.0 adds an `enclosure` source to the `smart` group, run after `udev`. It
reads `/sys/class/enclosure` and posts one line per file: `<path relative to
/sys/class/enclosure>\t<value>`.

- Per enclosure: `id`, `components`, `device/vendor`, `device/model`.
- Per slot (any child directory with a `slot` file): `slot`, `status`, `locate`,
  `fault`, `device/block/<name>/dev`. The block device name is in the path, and the
  value is its MAJ:MIN.
- An empty body means no enclosures. It is posted anyway, so a removed enclosure
  clears.

The parser `server/ingest/enclosure.ts` returns `{ enclosures: [{ name, id, vendor,
model, components, slots: [{ element, slot, status, locate, fault, device, devnum }] }] }`.
It normalises `id` to lowercase hex without `0x`, and drops elements whose `slot` is
not a non-negative integer (some SES firmware reports `-1`). The mars fixture is
`test/fixtures/mars/enclosure.txt`, captured with `bin/capture-enclosure.sh`.

Collectors older than 0.5.0 never post `enclosure`. Their hosts fall back to `ID_PATH`
locations.

### Storage

- **`Enclosure`** table: hostId, enclosureId (unique per host), name (the SCSI
  address), vendor, model, slots (json: element, slot, status, locate, fault, devnum),
  lastSeenAt. The enclosure handler replaces a host's rows on each post, and an empty
  body deletes them. This stores empty slots and SES status, and nothing goes on
  `Disk` for those.
- **`Disk`** gets three columns:
  - `lastIdPath` (text): from udev, always overwritten. The key is
    `ID_PATH_ATA_COMPAT ?? ID_PATH`, so both ATA spellings agree.
  - `lastSlot` (json `{ enclosureId, slot }`): set by the enclosure handler.
  - `lastLocationKey` (text): `enc:<enclosureId>:<slot>` when `lastSlot` is set,
    otherwise `path:<lastIdPath>`. It is the join key to `Bay` and the value compared
    for moves.
- **`Bay`** table: hostId, locationKey (unique per host), label. The label belongs to
  the place, not the disk, so a disk moved to another bay picks up that bay's label.
- None of these are cleared when a disk goes absent. The last known bay of a dead or
  pulled disk is the point of this feature.

### Matching and moves

- **Slot to disk**: match by `devnum`, not by `/dev/sdX`, because letters get reused
  and `lastDevicePath` can hold a partition. Read the host's `Payload(udev,
  device=b<devnum>)`, run `udev.parse`, then `extractKeys`, then `matchKeys` (all
  existing functions in `server/services/disks.ts`). This works in any ingest order.
- **Enclosure handler**:
  - Sets `lastSlot` for each occupied slot.
  - Clears `lastSlot` for disks that have a udev payload in this run but no slot. A
    disk that has gone absent keeps its slot.
  - Recomputes `lastLocationKey` for the disks it touched.
- **`observeUdev`** sets `lastIdPath`. It recomputes `lastLocationKey` only on hosts
  with no `enclosure` payload ever (pre-0.5.0 collectors). Otherwise a disk moving
  into an enclosure would get two keys in one run.
- **Diary**: a `moved-bay` entry (`DIARY_EVENT_TYPES` in `shared/diary.ts`) when
  `lastLocationKey` changes from one non-null value to another.
  - The first observation is silent.
  - Skipped when the host changed in the same run, because `moved-host` already
    covers it.
  - The title uses labels when they exist ("Moved from Bay 3 to Bay 5"), otherwise
    the derived defaults.
- **PCI renumbering** produces one `moved-bay` per path-keyed disk and orphans their
  labels. Accepted. The host page lists orphaned labels so they can be re-pointed or
  deleted.

### Labels and defaults

Without a label, show a derived default:

- `RES2SV240 slot 8` (enclosure model and slot)
- `SATA port 5` (from `-ata-N`)
- `NVMe 01:00.0` (from the PCI address)
- otherwise the raw `ID_PATH`

### API

- The disk payload gains `bay: { locationKey, label, defaultLabel } | null`.
- `GET /api/hosts/:id/bays` returns, per enclosure, every slot (occupant disk if any,
  label, status), then path-keyed locations of present disks, then orphaned labels.
- `PATCH /api/hosts/:id/bays` takes `{ [locationKey]: label | null }`, merging, with
  null deleting. The zod schema lives in `shared/schemas/`. The disk page and the host
  page both write through it.

### UI

- **Disk page**: a "Bay" fact beside "Device" in `app/components/disk/DiskOverview.vue`.
  It shows the label, with the default as the placeholder, and is editable with
  `InlineField`. Its save handler calls the bays PATCH, not `DiskPatch`.
- **Host page**: a "Bays" tab in `app/pages/hosts/[id].vue`. It lists every slot,
  including empty ones and SES status, plus path locations and orphaned labels, each
  label editable.
- **Topology**: `app/components/topology/DiskTile.vue` already uses its second line
  for the model. Add the bay label as a third, muted line, only when a label is set.

### Out of scope

- Lighting anything ([064](064-Disk-identify-light.md)).
- Faults from SES `status` or `fault`; they are stored only.
- Reading `vdev_id.conf` bay topologies.
- `sg_ses`.
- Label templates ("Bay {slot − 7}").

## Implementation

1. ~~Collector `enclosure` source, tests, capture, scrub, mars fixture.~~
2. ~~Parser, `INGEST_SOURCES`, registry, freshness group.~~
3. Schema: `Enclosure`, `Bay`, and `Disk.lastIdPath`, `lastSlot`, `lastLocationKey`.
   Migration `bay_mapping` generated by drizzle-kit.
4. Services:
   - `locationKeyFromUdev()` with tests for `ata-5`, `ata-5.0` with COMPAT, SAS, NVMe
     and USB.
   - `HANDLERS.enclosure` and the `Enclosure` upsert.
   - Slot matching by devnum.
   - The `lastLocationKey` rules and the `moved-bay` diary entry.
   - The `Bay` service: list and patch.
   - Add `enclosure` to the demo seed's idempotent sources (`server/demo/seed.ts`),
     since the handler replaces rows.
5. Demo: one demo host behind an SES expander, with `sas-exp0x…` paths and a rendered
   enclosure body; replace the `SOURCE_META.enclosure` placeholder in
   `server/demo/types.ts`. Label some bays.
6. API: disk payload `bay`, then `GET` and `PATCH /api/hosts/:id/bays`. Add an e2e
   test in `test/api/disks.e2e.test.ts` that posts the mars udev payloads, then
   `enclosure.txt`, and asserts `K1` is at `enc:…:8`.
7. UI: the disk page fact, the host page tab and the topology line.

## Questions

1. Should `enc:` labels be global, so a JBOD moved between hosts keeps its labels?
   Proposed: per host, like everything else.
2. Should USB locations be labellable, given they change with each plug? Proposed:
   yes, it's harmless.
