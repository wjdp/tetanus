---
type: task
status: in-progress
---

# Unsupported OpenZFS fails silently

On a host running OpenZFS 2.2, tetanus never learns about the host's pools, and nothing
tells the user. The visible symptom is that the boot NVMe shows as **spare**: its root
pool is on one partition (`p4`) and the OS filesystems are on the others.

## Problem

The collector needs OpenZFS 2.3+ (`host/README.md`) because `zpool-status`,
`zpool-list`, `zfs-list` and `zfs-snapshots` all use `-j`. On 2.2 those commands exit
non-zero with no stdout. `submit` in `host/tetanus-collect` then skips the POST and logs
only on the host, so the server receives nothing for those sources: no payload, no
`CollectorRun` row, no fault.

The sources that don't need JSON (`zpool-history`, `zpool-events`, `zfs-receives`, ZED
events) still arrive, so the host looks healthy. The `versions` payload reports
`zfs=zfs-2.2.2-…`, but the server doesn't check it.

What happens as a result:

- No `Pool` or `Vdev` rows, so pool disks aren't members and `inferState` doesn't
  count them as in use.
- No pool health, capacity or scrub tracking, and no ZFS faults for the host.
- The ZED event and history diary entries name a pool that tetanus doesn't otherwise
  know about.

### Secondary: mounts ignored for zfs-kind disks

Even without pool data, the disk mounts `/`, `/boot`, `/boot/efi`, `/tmp` and
`/var/tmp`, and `usage.system` is true. But because one partition is a `zfs_member`,
`inferUsage` (`server/services/usage.ts`) reports the disk as `kind: "zfs"`, and
`isMounted` (`shared/usage.ts`) counts only `kind === "filesystem"`. So the mounts
don't count, and `usageDetail` shows "zfs label, no pool" and hides them.

## Fix

The collector still runs on an unsupported host, but the host is marked **degraded**:
SMART, history, events and ZED still arrive, and tetanus says plainly what is missing.

- Installer (`host/install.sh`): check `zfs version` ≥ 2.3 and `smartctl --version`
  against its floor next to the existing `command -v` checks. If either is too old, warn and carry
  on: name the version found, the minimum, the sources that won't work, and the upgrade
  path. Don't fail the install.
- Add host page: list the minimum versions next to the install command.
- Server: parse `versions`. When OpenZFS < 2.3 (or smartmontools below its floor, see
  Decision), open a `host-degraded` **warning** (amber) fault on the host. It names
  the version, the minimum and the missing sources. It stays open until the user
  **accepts** it through the existing `FaultAcceptance`. `acceptedValue` is the
  version, encoded as an integer (`major*10000 + minor*100 + patch`), so a different
  unsupported version raises it again. It resolves when a later `versions` meets the
  minimum. It shows on the host page through `HostFaults` and in the fault banners
  until accepted.
- Collector: when a command fails with no output, still POST, or send a run-status
  record, so the server sees the failed source rather than silence. Check how
  `CollectorRun.ok`/`error` would represent it. Stays dumb: no version gating on the
  host.
- Host page: show, per source, when data was last received, so a source that is
  missing is visible.
- State inference: on a degraded host, `inferState` treats a disk with a `zfs_member`
  partition as in a pool (**in use**), not **spare**. Pool membership can't be known
  there, so this errs safe, and `usageDetail` says why.
- Secondary: make `isMounted` true whenever `mounts.length > 0`, whatever the usage
  kind; check its other callers. Show mounts in `usageDetail` for zfs-kind disks too.

## Decision

Don't support OpenZFS < 2.3; flag it. The minimum in
[001](001-Product-goals.md) stands.

- The useful part is `zpool status`: vdev membership (which fixes the **spare**
  symptom), state, errors and scan. Its text form is an indented tree with a prose
  `scan:` line, and leaf GUIDs need a second `-g` pass. A second parser for that is
  fragile and doubles the tests for the most important source. The `-Hp` list forms
  are easy, but pools without topology don't fix anything here.
- 2.2 holdouts have an upgrade path: Ubuntu 26.04 LTS, Debian 13 and Proxmox VE 9 all
  ship 2.3+.
- The text parsers from [024](024-ZFS-property-audit.md) use text because `get` output
  is stable, not to support 2.2. That doesn't change.

Unsupported hosts still run, degraded; see Fix.

### smartmontools floor

7.4 has no recorded reason. It came in with "Ubuntu 26.04-like" in
[001](001-Product-goals.md). The real dependency is `--json`, which arrived in 7.0, and
the `smartctl-xall` tests already parse 7.0, 7.1 and 7.3 fixtures. Ubuntu 22.04 ships
7.2 and Debian 12 ships 7.3. So the floor is 7.0: below it the SMART sources fail and
the host is degraded, the same as for ZFS. 7.0 to 7.3 are supported. Update the
minimum in 001, `host/README.md`, [054](054-Hosts-page.md) and
[062](062-Non-Linux-hosts.md) to match.
