---
type: task
status: planned
---

# Non-Linux hosts

Stub. The collector assumes a systemd Linux with OpenZFS 2.3+ and smartmontools 7.4+.
Decide what to say to everyone else.

## Problem

Home ZFS runs on more than Ubuntu. People will ask about:

- **TrueNAS SCALE**: Debian-based, systemd, OpenZFS 2.3 in recent releases, but the
  root is read-only and `/usr/local` is not meant to be written; the install script's
  paths and `zed.d` symlink may not survive an upgrade.
- **Proxmox VE**: Debian with its own OpenZFS build; closest to supported.
- **TrueNAS CORE / FreeBSD**: no systemd, `rc.d` and cron instead, `zpool`/`zfs`
  JSON output depends on the OpenZFS version shipped, smartmontools from ports,
  no udev (`/run/udev/data` does not exist), `camcontrol` instead of `lsblk`.
- **Unraid, Synology**: ZFS present but non-standard; probably out of scope.
- **Older Linux** (Debian 12, Ubuntu 22.04): OpenZFS 2.1/2.2 has no `-j`. The
  collector's `lsblk` fallback already handles one old-util-linux case.

The product goals say Linux ([001](001-Product-goals.md), minimum host Ubuntu
26.04-like). That is the right v1 scope; this task is about the boundary and the error
experience, not necessarily supporting more.

## Context

- The collector is one bash script plus units (`host/`); sources it posts are listed
  in `host/README.md`. The server rejects ZFS JSON with `vers_major != 0` and treats
  missing lsblk columns as unknown.
- `versions` source sends `lsb_release -ds`, `uname -r`, `zfs version`, `smartctl
  --version`; [035](035-Collector-version-tracking.md) flags outdated and incompatible
  collectors from it, so "unsupported platform" has a place to be shown.
- The install script is idempotent and serves its own files from the server, so a
  platform branch (different unit paths, cron instead of timers) is possible without a
  second installer.
- Identity depends on udev `S:` links and `ID_SERIAL`/`ID_WWN`; without udev the
  identity match would need to come from smartctl and `zpool status -P` alone.

## Questions

1. Which of these does anyone actually ask for? Wait for issues, or pre-empt in the README?
2. Is "fail clearly with a named reason" on an unsupported host enough for now?
3. Would a Proxmox or TrueNAS SCALE test VM be cheap enough to keep in CI?
