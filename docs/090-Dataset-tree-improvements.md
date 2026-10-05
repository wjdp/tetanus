---
type: task
status: todo
---

# Dataset tree improvements

## Problem

The dataset tree on the pool page's Datasets tab is a static table of current values.

- It can't be sorted, so you can't find the biggest or fastest-growing datasets.
- It doesn't show change: no 30-day growth column and no trend of space over time.

## Context

- `DatasetTree.vue` (`app/components/dataset/`) renders a `UTable` over `visibleTreeRows` (`treeRows.ts`), which flattens the tree in the server's path order (`listDatasets` in `server/services/zfs/datasets.ts`) and handles collapse.
- It's a tree, so the usual convention is to sort siblings within each parent and keep the hierarchy, rather than sorting a flat list.
- [050](050-Disk-list-columns-and-views.md) covers sorting and views for the disk list; reuse its approach where it fits.
- `DatasetReading` stores `used`, `referenced`, `available` and `usedBySnapshots` for each dataset once a day, plus an extra row when a value changes beyond a threshold (`readingDue`). The dataset page already loads recent readings (`recentDatasetReadings`).
- `app/components/charts/Sparkline.vue` exists.
- Depends on [089](089-Dataset-space-treemap.md), which adds the server-side `growth` field (`{ used, data, snapshots, sinceAt }`) to `listDatasets` rows. Growth can be "since <date>" for young datasets.
