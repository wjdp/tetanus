---
type: reference
---

# Collector OS support

What the host collector does on each home NAS OS, as measured by the collector matrix
(`.github/workflows/collector-matrix.yml`). It runs weekly, on demand and before every
release. This page records the current state; it doesn't propose changes. For the
boundary and what to say to unsupported hosts, see [062](062-Non-Linux-hosts.md) and
[079](079-Unsupported-OpenZFS-fails-silently.md).

## How it is measured

- **script**: `host/test/run.sh` (stubbed `zpool`, `smartctl`, `lsblk`, `curl`) inside
  each distro's container image. This tests the script against that distro's bash,
  coreutils, grep, sed and awk (mawk on Debian and Ubuntu, gawk on Alma). The tools in a
  container are not the host's, so this tests nothing else.
- **VM**: `host/test/matrix/vm.sh` boots the distro's cloud image under QEMU/KVM with
  two emulated SATA disks and one emulated NVMe disk. It installs the distro's own
  OpenZFS and smartmontools (`provision.sh`) and reboots. Then `scenario.sh` builds a
  mirror pool on the SATA disks, a single-disk pool on the NVMe, a zvol, snapshots, an
  incremental send/receive and a scrub. It runs `tetanus-collect --dry-run`, and
  `bin/parse-capture.ts` passes every payload to its server parser. The job fails on any
  parse error, or if the set of sources whose command fails differs from the matrix's
  `expect-failed` for that distro. The capture is uploaded as an artifact.

## Results

As of 2026-10-04. The script job passes on all seven images: Debian 12 and 13, Ubuntu
22.04, 24.04 and 26.04, AlmaLinux 9 and 10.

| distro | kernel | OpenZFS | smartctl | bash | curl | result |
| --- | --- | --- | --- | --- | --- | --- |
| Ubuntu 22.04 | 5.15 | 2.1.5 | 7.2 | 5.1 | 7.81 | degraded |
| Ubuntu 24.04 | 6.8 | 2.2.2 | 7.4 | 5.2 | 8.5 | degraded |
| Ubuntu 26.04 | 7.0 | 2.4.1 | 7.5 | 5.3 | 8.18 | works |
| Debian 12 + bookworm-backports | 6.1 | 2.3.2 (DKMS) | 7.3 | 5.2 | 7.88 | works |
| Debian 13 | 6.12 | 2.3.9 (DKMS) | 7.4 | 5.2 | 8.14 | works |
| Proxmox VE 9 | 7.0 pve | 2.4.4 | 7.5 | 5.2 | 8.14 | works |
| AlmaLinux 9 | 5.14 | 2.2.11 (kmod) | 7.2 | 5.1 | 7.76 | degraded |
| AlmaLinux 10 | 6.12 | 2.2.11 (kmod) | 7.4 | 5.2 | 8.12 | degraded |

**Works**: every source posts and parses. The only failed command is `vdev-id-conf`,
because the VMs have no `/etc/zfs/vdev_id.conf`.

**Degraded**: `zpool-status`, `zpool-list`, `zfs-list` and `zfs-snapshots` fail with
`invalid option 'j'` (OpenZFS < 2.3), so these hosts have no pools, vdevs or datasets.
Every other source works and parses: `versions`, `zpool-history`, `zfs-receives`,
`zpool-events`, `lsblk`, `udev`, `enclosure`, `smartctl-scan` and `smartctl-xall`.
The host gets a `host-degraded` fault ([079](079-Unsupported-OpenZFS-fails-silently.md)).

Across distros, no command names, paths or flags differed. Every distro has
`/run/udev/data`, `/dev/disk/by-id` links, the same `smartctl --scan` device types
(`/dev/sdX` auto-detected as SAT, `/dev/nvme0` as `-d nvme`) and `lsblk` with
`MOUNTPOINTS`.

### Observations

- The OpenZFS RHEL repository (`zfs-release`, `zfs-kmod`) installs 2.2 on EL9 and
  EL10, so an Alma or Rocky user who follows the OpenZFS docs gets a degraded host.
  Untested: whether another repository in `zfs-release` ships 2.3+.
- On 2.2 the failure reported for `zfs-list` and `zfs-snapshots` is the end of the
  usage text (the property table), not the `invalid option 'j'` line, because the
  collector sends only the last 4 KiB of stderr.
- `udev` is posted for every `lsblk` disk, including the floppy (`b2:0`, Ubuntu cloud
  images) and zvols (`b230:*`).

## Not covered

- TrueNAS SCALE and CORE, Unraid, FreeBSD, NixOS, Arch: no cloud image the matrix can
  boot as-is.
- The installer, systemd timers and the ZED hook: the VM runs the collector directly.
- Real hardware: SAS HBAs, SES enclosures, USB bridges, `-d megaraid` and similar
  types, disks in standby. The emulated disks are SATA and NVMe only.
- `vdev_id.conf`, and pools on partitions or with special, log, cache or spare vdevs.
