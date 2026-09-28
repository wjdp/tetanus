---
type: task
status: todo
---

# Non-ZFS disk usage

mars's boot NVMe (`453939583131`, ext4 root on LVM) shows as `spare` because state
inference in [003](003-Architecture-and-data-model.md) §Disk state only knows one way
to be in use: pool membership. Not every disk is a vdev. Spec agreed 2026-09-28.

## Decisions

- Detect from the collector: partition `FSTYPE` (already shipped) plus mount points
  (new column). Descend into lvm/crypt children so mounts on `/dev/mapper/*` count.
- New inferred **usage** axis, separate from state. State keeps its lifecycle meaning
  (`in-use | spare | missing | removed | unseen`); `in-use` now derives from either
  pool membership or a mounted non-ZFS filesystem.
- Manual **purpose** is an inventory label, never a state override: `system | other`,
  null = inferred. A disk with `purpose` set but nothing mounted still shows `spare`.
- `system` is inferred when any filesystem on the disk is mounted at `/` or `/boot`.
- No alias for non-ZFS disks; alias stays the vdev cohort scheme. Render as
  `mars · system`.
- Diary on usage **kind** change only, not on mount path changes.
- Topology side rail gains a `System` group; purpose shows as a badge.

## Collector

`host/tetanus-collect` `ensure_lsblk`: append `MOUNTPOINTS` to the column list.
`MOUNTPOINTS` needs util-linux 2.37+ (Debian 12, Ubuntu 22.04); if lsblk rejects it
fall back to `MOUNTPOINT`. Same change in `bin/capture-fixtures.sh` and the
`host/README.md` command table. Bump the collector version. The mars fixture must be
re-captured on the host (user action); until then the parser treats a missing
`mountpoints` as unknown, not empty.

## Parser (`server/ingest/lsblk.ts`)

- `LsblkPartition` gains `mountPoints: string[]` (`mountpoints` filtered of nulls, or
  `[mountpoint]`) and `children: LsblkChild[]` for nested `lvm | crypt | raid*` nodes,
  each with `name, path, type, fsType, mountPoints, children`.
- Whole-disk filesystems: `fstype` and `mountpoints` on the disk node itself
  (`zfs_member` without a partition table, or a bare ext4). Record as `fsType` and
  `mountPoints` on `LsblkDisk`.
- Fixture: extend `test/fixtures/mars/lsblk.json` once re-captured; add a synthetic
  fixture with a lvm-on-luks chain and a whole-disk ext4 for the parser tests.

## Usage inference (`server/services/disks.ts`)

```ts
type UsageKind = "zfs" | "filesystem" | "empty" | "unknown";
interface DiskUsage {
  kind: UsageKind;
  fsTypes: string[];        // distinct, excluding zfs_member's reserved partition
  mountPoints: string[];    // flattened across partitions and mapper children
  system: boolean;          // any mountPoint is "/" or "/boot"
}
```

- `zfs`: any `zfs_member` fstype, or `Vdev.diskId` present (pool wins over stale labels).
- `filesystem`: any other fstype anywhere in the tree (`LVM2_member`, `crypto_LUKS`,
  `swap` count; mapper children resolved for mounts).
- `empty`: no fstype anywhere. `unknown`: no lsblk payload yet, or old collector
  without mount columns and a non-ZFS fstype present (cannot tell mounted from stale).
- Persist `Disk.latestUsage` (json column, migration `add_disk_usage`) on `observeLsblk`,
  same pattern as `latestRaw`. Compute-on-read is not enough: usage feeds the
  `inPool`-style set in `stateResolver`, and `Payload` is only the latest body.
- `inferState` gains `mounted: boolean` (usage.kind === "filesystem" and
  `mountPoints.length > 0`): `present && (inPool || mounted)` → `in-use`.
  Unmounted filesystem stays `spare`; the disk page shows "has ext4 data".
- Kind change → diary `usage-changed` with `{ from, to, fsTypes }`, title such as
  `formatted ext4`, `joined pool tank`, `wiped`. Suppressed when either side is
  `unknown`.
- `purpose` resolution for display: `inventory.purpose ?? (usage.system ? "system" : null)`;
  return both `purpose` and `purposeInferred: boolean` from `listDisks`/`getDisk`.

## Inventory

`shared/inventory-fields.ts`: `{ key: "purpose", label: "Purpose", type: "enum",
values: ["system", "other"] }`. Registry already drives the zod schema, form and table.
Form shows the inferred value as placeholder when unset.

## UI

- Disk page nameplate: replace the lone state badge with state + usage detail
  (`in-use · ext4 on / (lvm)` / `spare · has ext4 data` / `in-use · tank`); purpose
  badge, greyed when inferred. Header subtitle for aliasless disks: `mars · system`.
- Topology side rail (`groupDisks.ts` `RAIL_ORDER`): add `System` before `Spare` for
  disks with resolved purpose `system`; mounted non-system disks go under the existing
  `In use, not in a pool` group. Purpose badge on rail rows.
- Disks list: `Usage` column (`tank` / `ext4 /` / `empty`), filterable; purpose in the
  inventory table.
- Dashboard counts: `spare` count excludes system disks.

## Alerts and other consumers

- `missing` alert unchanged; a missing system disk means the host is silent anyway and
  the collector-silence fault covers it.
- `zpool-status` alias resolution untouched.

## Out of scope

- mdraid, bcache, btrfs multi-device membership beyond "has a filesystem".
- Per-filesystem capacity or mount health.
- Purpose values beyond `system | other`; widen the enum if a need appears.

## Findings

(agents append here)
