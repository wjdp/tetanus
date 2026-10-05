---
type: task
status: done
---

# Dataset space treemap

A WinDirStat-style treemap of where a pool's space goes: one rectangle per dataset, area proportional to space, nested by the dataset hierarchy. Lives on a new Space tab on the pool page.

Decisions agreed 2026-10-05: own Space tab; free-space tile toggleable; growth colour mode in v1; time travel in v2; phones get a wider-screen note; per pool only, no fleet-wide map; `DatasetReading` gains `usedByDataset`/`usedByChildren` (one migration). Reviewed by Fable 2026-10-05; findings folded in. Table-view improvements (sorting, growth column, sparkline) are in [090](090-Dataset-tree-improvements.md).

## Problem

The pool page's Datasets tab is a tree table. It answers "how big is X" but not "what is eating the pool". Big consumers buried three levels deep, and snapshot space hiding under a small live dataset, are hard to spot from a column of numbers.

## Context

- Data is already collected and stored, no collector change. `zfs-list` carries `used`, `usedbydataset`, `usedbysnapshots`, `usedbychildren`, `available`, `logicalused`, `compressratio` (`server/services/zfs/datasets.ts`, `Dataset` in `server/database/schema.ts`). `refreservation` and `usedbyrefreservation` are not collected.
- `GET /api/pools/:id/datasets` (`listDatasets`) already returns the whole tree with `parentId`. The Datasets tab lazy-loads it (`app/pages/zfs/[id].vue`) and renders `DatasetTree.vue`.
- ZFS space identity: `used = usedbydataset + usedbysnapshots + usedbychildren + usedbyrefreservation`. So a dataset's own space is `used - usedbychildren`, and what's left after `usedbydataset + usedbysnapshots` is refreservation (thick zvols). Derive it; no need to collect it.
- Pool-level numbers (`zpool list` `alloc`/`size`) include raidz parity and padding; dataset numbers don't. The two must not share one map.
- `DatasetReading` keeps one row per dataset per day plus extra rows on changes over 1 % (`readingDue`), retained 400 days: `used`, `referenced`, `available`, `usedBySnapshots`. No `usedByDataset`/`usedByChildren`, so a dataset's own space at a past date can't be read directly.
- Clones: blocks shared with a clone are counted in the origin's `usedbysnapshots`, so snapshot space on an origin may be clone-backed rather than bloat. `origin` isn't collected.
- No chart library in the app; existing charts are hand-rolled SVG (`app/components/charts/`).

## Library

Use `d3-hierarchy` for layout. Rendered as absolutely positioned divs rather than SVG: text truncation, `NuxtLink`, focus and CSS transitions come free, and ~1500 elements is fine. Researched 2026-10-05:

| Library | Verdict |
| --- | --- |
| `d3-hierarchy` | **Chosen.** 5.6 kB gzip, ISC, layout only (no DOM). Gives true nesting, `treemapSquarify`, and `paddingTop` for header strips. Theming, links, tooltips and a11y stay ours. Last release 2022; the algorithm is finished. |
| ECharts 6 + vue-echarts | Fallback. Has built-in drill-down and breadcrumb, but it's ~150 kB tree-shaken, needs `<ClientOnly>`, and styling goes through an options object that must be re-applied on theme change. |
| Highcharts, ApexCharts | Licences don't fit a self-hosted project (commercial / revenue-capped). ApexCharts isn't truly nested either. |
| Plotly | 1.4 MB. |
| Nivo | React only. |
| vue-data-ui, Unovis | Workable, but we'd fight their look and feel to match Nuxt UI. |

A sunburst or icicle view (`d3.partition`) could reuse the same hierarchy data later.

## Proposal

### Layout

- Root is the pool's root dataset. Each dataset is a nested box containing its children, with a header strip for its name when the box is big enough (`paddingTop`).
- Each dataset with its own space gets leaf tiles, grouped and stacked top to bottom (`treemapSlice`) so snapshots always sit under data whatever their size:
  - **data** (`usedbydataset`)
  - **snapshots** (`usedbysnapshots`), hatched so snapshot bloat stands out; this is the main payoff
  - **reserved** (the derived refreservation residue, only if > 0)
- **Free** tile at root, sized by root `available` (not `zpool` free), toggled by the user, off by default.
- Squarified layout. `paddingInner` 1 px. `paddingTop` as a function: a header strip only within two levels of the current zoom root and only on boxes at least ~40 px tall. Nested padding is subtracted before children are sized, so keeping it thin keeps deep datasets honest.
- Parent boxes are filled with their colour, so children too small to render still show as area (WinDirStat convention). Tiles below a few pixels aren't rendered; zero-sized tiles (empty parents, `usedbydataset` 0) are omitted.
- Destroyed datasets (`present = false`) are excluded.
- Percent of pool is over root dataset `used`, or `used + available` when the free tile is on; never `zpool` size.

### Colour

A toggle between two modes:

- **Branch** (default): the seven biggest first-level children of the root get a hue from the dataviz reference categorical palette (its red slot left out, as red means alarm here), and their descendants share it, as in WinDirStat. Further branches fold into grey "other" rather than cycling. The root's own tiles are grey. Snapshot and reserved tiles use a tint of their dataset's hue.
- **Growth**: a diverging scale on per-tile growth, zero-centred, signed symlog, clamped at the 95th percentile of |growth| so a few big datasets don't saturate it. Blue (shrinking) to red (growing) through a grey midpoint, the reference palette's colour-vision-safe diverging pair; the hatch stays the non-colour cue for snapshots. Tiles with null growth are neutral grey.

All colours are CSS variables with light and dark values.

### Readings migration

Add nullable `usedByDataset` and `usedByChildren` to `DatasetReading` (migration `dataset_reading_space_split`), written by `recordReadings`. Older rows stay null; growth that needs them is null until a baseline with them exists.

### Growth figure

Computed once in `listDatasets` and added to each row as `growth: { used, data, snapshots, sinceAt } | null`:

- Baseline: the latest reading at or before 30 days ago; else the earliest reading if it is at least 7 days old; else null. `sinceAt` is the baseline's `at`, so a young (or renamed, which looks new) dataset reads "since <date>", not "30 d".
- `used`: `used` now minus baseline `used` (box colour, tooltip, [090](090-Dataset-tree-improvements.md) column).
- `snapshots`: `usedBySnapshots` delta (snapshot tile).
- `data`: `usedByDataset` delta (data tile); null if the baseline predates the migration.
- Reserved tiles have no growth.
- Two grouped queries over `DatasetReading` for the pool's present datasets (latest `at` ≤ T; earliest), as `recordReadings` does.

### Interaction

- Hover: tooltip with full name, used, and the data / snapshots / children / reserved split, plus compress ratio, percent of pool and growth ("+12 GB since 5 Sep"). On snapshot tiles, a caveat that clone-backed space counts here.
- Click a box: zoom into that dataset by re-rooting and re-running the layout, with a breadcrumb back up built from `node.ancestors()`.
- The name in a header strip links to `/datasets/:id`.
- Legend for the colour mode; the hatch pattern is labelled as snapshots.
- One delegated `mousemove`/`focusin` handler on the `<svg>` reading data attributes, not per-tile listeners (~1500 rects at 500 datasets). Layout in a `computed` keyed on observed width and height.
- Keyboard: boxes and tiles are focusable, Enter zooms or follows the link, Escape zooms out.

### Placement

- New **Space** tab on the pool page, after Datasets. The map is 80vh tall (at least 360 px). It loads `/api/pools/:id/datasets` lazily and shares the result with the Datasets tab, so switching tabs doesn't refetch.
- Below `md` (phones) the tab stays listed and its content is a "needs a wider screen" note, done with CSS (`hidden md:block`) to avoid a hydration mismatch.
- Colour mode and free-tile toggle remembered per viewer in `localStorage`, read in `onMounted` with try/catch as `DiskAttributeTable.vue` does.

### Work

- Add `d3-hierarchy` and `@types/d3-hierarchy`.
- Migration `dataset_reading_space_split`; `recordReadings` writes the new columns.
- Server: the `growth` field on `listDatasets` rows, with unit tests (no reading, under 7 days, young dataset uses earliest, pre-migration baseline gives null `data`, destroyed datasets excluded).
- `test/api/` route assertion for `growth` on `/api/pools/:id/datasets`; a `*.seeded.test.ts` over the demo fleet (a baseline exists, a snapshot-heavy dataset shows snapshot growth).
- A pure `buildSpaceHierarchy(rows, { free })` in `app/components/dataset/` that turns `DatasetTreeRow[]` into the hierarchy with derived leaf tiles. Unit tests cover the reserved residue, null `usedBy*` values, volumes, destroyed datasets and the free tile.
- `DatasetTreemap.vue`: layout, SVG render, hatch `<pattern>` (id via `useId()`, fill via `currentColor`), colour scales, tooltip, zoom and breadcrumb, legend, keyboard, resize observer.
- The Space tab in `app/pages/zfs/[id].vue`, with shared lazy loading.
- Check that the demo fleet (`server/demo/zfsDatasets.ts`) has a varied enough tree and some snapshot-heavy datasets for the map to look right.
- Demo readings: daily grid instants in the last 40 days post `zfs-list`, so the demo has a 30-day baseline (`isDatasetHistoryRun` in `server/demo/seed.ts`).
- App tests for the component and tab.
- Update the `Dataset` and `DatasetReading` columns in [003](003-Architecture-and-data-model.md) §Data model, which are out of date.

## v2

- Time travel: choose a past date and draw the map from `DatasetReading`, using the split columns added here.
- Collect `origin` to mark clone-backed snapshot space properly.
- A sunburst or icicle view over the same hierarchy.
