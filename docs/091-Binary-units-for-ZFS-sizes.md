---
type: task
status: todo
---

# Binary units for ZFS sizes

Decided 2026-10-05: default to TiB; the TB/TiB choice is a per-viewer `localStorage` setting. Server-built text (alerts, diary, fault reasons) uses TiB for ZFS sizes, since it can't see the viewer's setting.

## Problem

The app shows every size in decimal units (TB). `zfs` and `zpool` print binary units, where a "T" is a TiB, so ZFS figures don't match the CLI. For example, `zfs list` shows 37.4T available on a pool where the app shows 41.2 TB. People think about pools and datasets in file terms and compare against the CLI. ZFS sizes should default to TiB, with a toggle between TB and TiB. Disk sizes stay decimal, because that's how vendors quote them.

## Context

- `formatBytes` (`app/utils/format.ts`) is decimal-only and used app-wide; `byteUnitFor` picks a unit for chart axes.
- ZFS views that format sizes: `app/pages/zfs/index.vue`, `app/pages/zfs/[id].vue` (capacity, alloc chart), `app/pages/datasets/[id].vue`, `app/components/dataset/` (`DatasetTree`, `DatasetTreemap`, `SnapshotTable`), `app/components/pool/` (`VdevTreeTable`, `ScanPanel`, `RemovalPanel`), `app/components/topology/` (`PoolCard`, `HostSection`, `VdevRow`; `DiskRail`/`DiskTile` mix disk and pool figures).
- Server-built text also has sizes: alerts, diary entries and fault reasons (e.g. pool capacity, [055](055-Pool-capacity-fault.md); dataset quota, [059](059-Dataset-quota-nearly-full.md)).
- Per-viewer settings like this have used `localStorage` so far; [051](051-Currency-setting.md) is a server-side display setting.
