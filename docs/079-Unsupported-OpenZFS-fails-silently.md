---
type: task
status: todo
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

- Server: parse `versions` and raise a host fault when OpenZFS < 2.3 or smartmontools
  < 7.4, naming the version and the requirement.
- Collector: when a command fails with no output, still POST, or send a run-status
  record, so the server sees the failed source rather than silence. Check how
  `CollectorRun.ok`/`error` would represent it.
- Host page: show, per source, when data was last received, so a source that is
  missing is visible.
- Secondary: make `isMounted` true whenever `mounts.length > 0`, whatever the usage
  kind; check its other callers. Show mounts in `usageDetail` for zfs-kind disks too.

## Open questions

- Support 2.2 through the text parsers (some already exist per
  [024](024-ZFS-property-audit.md)), or just flag it as unsupported? Ubuntu 24.04 LTS
  ships 2.2.
