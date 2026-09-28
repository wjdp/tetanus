# tetanus

A self-hosted disk and ZFS monitor for a home NAS. It tracks every disk the NAS has ever had: SMART health with scrutiny's attribute knowledge, lifecycle and inventory, ZFS pool topology, and a diary of what happened to each disk. A small host-side collector (bash, a systemd timer and a ZED hook) posts raw `smartctl`, `zpool` and `zfs` output to one unprivileged container, which does all the parsing.

**Status:** pre-alpha. Nothing works yet.

Design and plans are in [docs/](docs/000-Docs.md).

## Licence

MIT, see [LICENSE](LICENSE).
