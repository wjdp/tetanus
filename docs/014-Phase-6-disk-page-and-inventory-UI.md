---
type: task
status: todo
---

# Phase 6 disk page and inventory UI

Phase 6 of the [project plan](004-Project-plan.md): disk page, inventory table, charts,
command palette. Built on the Phase 3–5 APIs. Chart library decided 2026-09-28: uPlot
(canvas, ~45 kB, no framework coupling), wrapped once in `app/components/charts/`.

## Contract

- `/disks` inventory table: alias, model, serial, capacity, host, state, pool, status,
  temp, power-on age, calendar age, warranty left, 3.3 V pin. Sort, filter by
  host/state/pool, text search. Rows link to the disk page.
- `/disks/:id` disk page: nameplate (alias, model, serial, firmware, capacity, host,
  device path, state with override control), inventory edit form generated from
  `shared/inventory-fields.ts`, status summary, attribute table in scrutiny's layout
  (status, id, name, value, thresh, ideal, failure rate, sparkline, expandable
  description from metadata), trend chips, temperature chart and a chart for the
  selected attribute, self-tests, ZFS membership, diary timeline for this disk with a
  manual-entry form.
- `/diary` global timeline with subject/kind filters.
- Obsidian importer: `POST /api/import/obsidian` accepts a pasted markdown table or
  CSV; columns matched by header name (case-insensitive) to alias, model, serial,
  capacity, pool, status, and every inventory field label/key. Rows join to existing
  disks by serial, then alias; unmatched rows create inventory-only disks (`unseen`).
  Returns a preview `{ matched, created, skipped }` with `dryRun=true` first. UI under
  Settings › Import.
- Command palette: disks by alias/serial/model, pools by name, under a "Disks" and a
  "Pools" group, loaded lazily when the palette opens.
- Status colours per 008: failed = alarm, warning = amber, passed quiet (neutral),
  accepted/recovered = emerald only for recovery.

## Findings

(agents append here)

### Disk page and command palette (2026-09-28)

- Self-tests left out of `/disks/:id`: `recordSmartReading` stores them in `SelfTest`, but
  neither `SmartOverview` nor `DiskDetail` exposes them. Add `selfTests` (newest first,
  capped) to `GET /api/disks/:id/smart` or the disk detail, then a `DiskSelfTests`
  section.
- ZFS membership is found client-side by walking every tree from `GET /api/pools` for
  `VdevNode.disk.id`. Cheap at home scale, but `DiskDetail` could carry
  `membership: { poolId, poolName, path: string[], vdev }` since `diskIdsInPools`
  already queries `Vdev` per request.
- `SmartReading.deviceStatus` is the status line source; its reason is summarised as
  counts of failed/warning attributes. A `reason` per reading (as scrutiny shows) would
  need server work.
- Response types come from `InternalApi` in `nitropack/types` (type-only), in
  `app/components/disk/types.ts`, since Biome bans `~~/server` imports in `app/`.
- Nuxt scans `.ts` files under `app/components/` as components, so pure helpers there
  (`attributeOrder.ts`, `membership.ts`, …) register harmless phantom components and
  must not share a name with a `.vue` file (`zfsMembership.ts` clashed with
  `DiskZfsMembership.vue`). Worth setting `components: [{ path: "~/components",
  extensions: [".vue"] }]` or moving helpers to `app/utils/`.
- Charts: single series on a page, so strokes use `--ui-text-highlighted` (then
  muted/dimmed for extra series); axes `--ui-text-muted`, grid `--ui-border`, read at
  render and re-read on colour-mode change. No categorical palette was needed yet; rust
  never used. uPlot's live legend is the hover readout.
- Command palette loads disks and pools once, on first open; entities created after
  that appear on reload.
