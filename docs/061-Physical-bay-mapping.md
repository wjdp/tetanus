---
type: task
status: planned
---

# Physical bay mapping

Stub. When a disk fails, the next question is which bay it is in. tetanus knows the
alias and `/dev/sdX` and nothing about where the disk physically is.

## Problem

The author's alias scheme (`K1`, `L3`) encodes a bay by convention, and
`vdev_id.conf` is what maps a PCI/SAS path to that alias. Other users have no scheme,
and a disk behind a USB enclosure or on a motherboard SATA port has no bay at all.
Whatever can be learned from the host about physical location should be stored,
shown on the disk page and the topology, and used to make the "pull this disk" moment
unambiguous.

## Context

- udev (`test/fixtures/mars/udev/*`) carries `ID_PATH` (e.g.
  `pci-0000:01:00.0-nvme-1`, `pci-…-ata-3`, `pci-…-sas-phy5-lun-0`) and, for SAS and
  enclosure-attached disks, `SCSI_IDENT_PORT_NAA_REG`, `SCSI_IDENT_PORT_RELATIVE`,
  `ID_SAS_PATH`. tetanus parses the udev `E:` lines (`server/ingest`) but only uses the
  identity fields.
- `vdev_id.conf` is parsed (alias lines, both path forms) for alias matching; its
  `pci_slot`/`phy` form is itself a bay map and could be read as one.
- OpenZFS exposes `vdev_enc_sysfs_path` per leaf vdev (in `zpool status` JSON and
  via `zpool status -c`), pointing at `/sys/class/enclosure/<id>/<slot>` when the disk
  sits behind an SES-capable backplane or HBA. The current collector call does not
  request it and the mars fixture has none; mars may not have an enclosure at all.
- `/sys/class/enclosure/*/*/{slot,status,locate,fault}` is the kernel's view of SES
  slots; `sg_ses` and `lsscsi -g` are the userland tools. Reading `/sys` is a cat, no
  new dependency; `sg_ses` would be one.
- `smartctl --xall --json` for SCSI/SAS disks includes transport and port
  identifiers; ATA disks behind a SAS HBA report as ATA with a SAS `ID_PATH`.
- [064 Disk identify light](064-Disk-identify-light.md) depends on the same
  enclosure discovery.

## Questions

1. Which hardware does the author have to test against? Without an SES backplane the enclosure half is fixtures-from-strangers.
2. Is a user-entered "bay" inventory field (free text or a per-host grid) the fallback when nothing can be read?
3. Does the topology view show bays, or only the disk page?
