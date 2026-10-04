# USB bridge: placeholder WWN and split identity

One collector run from a host with a 4 TB SATA disk in a UAS USB enclosure
(`/dev/sda`) and an NVMe system disk. Serials, WWNs and UUIDs are scrubbed by
`bin/scrub-fixtures.py`; the host and mount path are renamed.

The bridge shows lsblk and udev a placeholder WWN (`0x5000000000000001`) and its
own model and serial, while `smartctl -d sat` sees the drive's. The manifest is
in collector order: lsblk and udev arrive before smartctl.

See `docs/078-USB-bridge-splits-a-disk-into-two-records.md`.
