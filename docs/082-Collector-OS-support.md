---
type: reference
---

# Collector OS support

Which home NAS operating systems the host collector supports, and on what evidence.
Measured rows come from the collector matrix (`.github/workflows/collector-matrix.yml`),
which runs weekly, on demand and before every release. Rows marked as not tested are
reasoned from the collector's requirements below. This page records the current state;
it doesn't propose changes. For the boundary and what to say to unsupported hosts, see
[062](062-Non-Linux-hosts.md) and [079](079-Unsupported-OpenZFS-fails-silently.md).

## What the collector needs

- **Collector** (`host/tetanus-collect`): bash, curl, coreutils (`mktemp`, `tail`,
  `head`, `tr`, `cat`), grep, sed, awk, `hostname`, `uname`; util-linux `lsblk` with
  JSON output; udev's `/run/udev/data` database; sysfs; OpenZFS 2.3+ (`-j` JSON output)
  and smartmontools 7.0+ (`--json`). `lsb_release` is optional; `/etc/os-release` is the
  fallback.
- **Installer** (`host/install.sh`): systemd (units in `/etc/systemd/system`, timers),
  a writable `/usr/local`, and ZED with `/etc/zfs/zed.d`.
- **Degraded** means OpenZFS older than 2.3 or smartmontools older than 7.0. The
  collector still runs; the commands that need JSON fail and the host gets a
  `host-degraded` fault.

## Support

As of 2026-10-04.

| OS | OpenZFS | status | evidence |
| --- | --- | --- | --- |
| Ubuntu 26.04 | 2.4.1 | works | matrix |
| Ubuntu 24.04 | 2.2.2 | degraded | matrix |
| Ubuntu 22.04 | 2.1.5 | degraded | matrix |
| Debian 13 | 2.3.9 (contrib, DKMS) | works | matrix |
| Debian 12 + bookworm-backports | 2.3.2 (DKMS) | works | matrix |
| Debian 12 (contrib only) | 2.1 | degraded | not tested; same as Ubuntu 22.04 |
| Proxmox VE 9 | 2.4.4 | works | matrix |
| AlmaLinux 9 and 10, with the OpenZFS repository | 2.2.11 (kmod) | degraded | matrix |
| Rocky Linux, RHEL | as AlmaLinux | degraded | not tested; same packages as AlmaLinux |
| Fedora, Arch (archzfs), Gentoo | usually current | probably works | not tested; systemd, udev and util-linux like the tested distros, so it depends on the OpenZFS version installed |
| TrueNAS SCALE | depends on release | not tested | Debian-based with systemd and udev, so the collector should run on a 2.3+ release, but the root filesystem is read-only and the installer's paths may not survive an upgrade ([062](062-Non-Linux-hosts.md)) |
| NixOS | depends on channel | not tested | the collector should run, but the installer can't write `/etc/systemd/system`; it would need a NixOS module |
| Unraid | depends on release | not tested | no systemd, so the installer won't work; the collector may run under cron |
| TrueNAS CORE, FreeBSD | depends on release | unsupported | no udev, no `lsblk`, no systemd |
| Synology DSM | none | unsupported | no OpenZFS |

## Matrix results

- **script** job: `host/test/run.sh` (stubbed `zpool`, `smartctl`, `lsblk` and `curl`)
  inside each distro's container image. This tests the script against that distro's
  bash, coreutils, grep, sed and awk (mawk on Debian and Ubuntu, gawk on AlmaLinux). It
  passes on all seven images: Debian 12 and 13, Ubuntu 22.04, 24.04 and 26.04,
  AlmaLinux 9 and 10.
- **VM** job: `host/test/matrix/vm.sh` boots the distro's cloud image under QEMU/KVM
  with two emulated SATA disks and one emulated NVMe disk. It installs the distro's own
  OpenZFS and smartmontools (`provision.sh`) and reboots. Then `scenario.sh` builds a
  mirror pool on the SATA disks, a single-disk pool on the NVMe, a zvol, snapshots, an
  incremental send/receive and a scrub. It runs `tetanus-collect --dry-run`, and
  `bin/parse-capture.ts` passes every payload to its server parser. The job fails on any
  parse error, or if the set of sources whose command fails differs from the matrix's
  `expect-failed` for that distro. The capture is uploaded as an artifact.

| distro | kernel | smartctl | bash | curl | sources failing |
| --- | --- | --- | --- | --- | --- |
| Ubuntu 22.04 | 5.15 | 7.2 | 5.1 | 7.81 | ZFS JSON four, `vdev-id-conf` |
| Ubuntu 24.04 | 6.8 | 7.4 | 5.2 | 8.5 | ZFS JSON four, `vdev-id-conf` |
| Ubuntu 26.04 | 7.0 | 7.5 | 5.3 | 8.18 | `vdev-id-conf` |
| Debian 12 + backports | 6.1 | 7.3 | 5.2 | 7.88 | `vdev-id-conf` |
| Debian 13 | 6.12 | 7.4 | 5.2 | 8.14 | `vdev-id-conf` |
| Proxmox VE 9 | 7.0 pve | 7.5 | 5.2 | 8.14 | `vdev-id-conf` |
| AlmaLinux 9 | 5.14 | 7.2 | 5.1 | 7.76 | ZFS JSON four, `vdev-id-conf` |
| AlmaLinux 10 | 6.12 | 7.4 | 5.2 | 8.12 | ZFS JSON four, `vdev-id-conf` |

The ZFS JSON four are `zpool-status`, `zpool-list`, `zfs-list` and `zfs-snapshots`,
which fail with `invalid option 'j'` on OpenZFS < 2.3, so those hosts have no pools,
vdevs or datasets. `vdev-id-conf` fails everywhere because the VMs have no
`/etc/zfs/vdev_id.conf`. Every other source posts and parses on every distro:
`versions`, `zpool-history`, `zfs-receives`, `zpool-events`, `lsblk`, `udev`,
`enclosure`, `smartctl-scan` and `smartctl-xall`.

Across distros, no command names, paths or flags differed. Every distro has
`/run/udev/data`, `/dev/disk/by-id` links, the same `smartctl --scan` device types
(`/dev/sdX` auto-detected as SAT, `/dev/nvme0` as `-d nvme`) and `lsblk` with
`MOUNTPOINTS`.

### Observations

- The OpenZFS RHEL repository (`zfs-release`, `zfs-kmod`) installs 2.2 on EL9 and
  EL10, so an AlmaLinux or Rocky user who follows the OpenZFS docs gets a degraded host.
  Untested: whether another repository in `zfs-release` ships 2.3+.
- On 2.2 the failure reported for `zfs-list` and `zfs-snapshots` is the end of the
  usage text (the property table), not the `invalid option 'j'` line, because the
  collector sends only the last 4 KiB of stderr.
- `udev` is posted for every `lsblk` disk, including the floppy (`b2:0`, Ubuntu cloud
  images) and zvols (`b230:*`).

## Not covered by the matrix

- Any OS in the Support table not marked "matrix": no cloud image the matrix can boot
  as it is, or not added yet.
- The installer, systemd timers and the ZED hook: the VM runs the collector directly.
- Real hardware: SAS HBAs, SES enclosures, USB bridges, `-d megaraid` and similar
  types, disks in standby. The emulated disks are SATA and NVMe only.
- `vdev_id.conf`, and pools on partitions or with special, log, cache or spare vdevs.
