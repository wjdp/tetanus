---
type: task
status: done
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

### Inventory table, diary and Obsidian importer (2026-09-28)

- Importer synonyms (`COLUMN_SYNONYMS` in `shared/importers/obsidianTable.ts`), matched
  after lowercasing and dropping everything but `a-z0-9./`, so `Serial Number`,
  `serial_number` and `serialNumber` are one key. First header wins per target.
  - alias: alias, name, id, disk, label
  - model: model, model number
  - serial: serial, serial number, serial no, sn, s/n
  - capacity: capacity, size
  - pool: pool, zpool
  - status: status, state
  - purchaseDate: purchased, purchase date, bought, date purchased
  - purchasePrice: price, cost, purchase price, paid
  - supplier: supplier, vendor, shop, seller, retailer
  - purchaseCondition: condition, purchase condition
  - warrantyExpiry: warranty, warranty expiry, warranty until
  - pin33Taped: 3.3v, 3.3 v pin, 3.3v pin, pin, 3.3 v, taped
  - plus every `INVENTORY_FIELDS` key and label.
- Cells: Obsidian wikilinks `[[K2]]` / `[[K2|label]]` reduce to their text; `—`/`-`
  count as empty. Unreadable values (bad date, `DEGRADED` status, invalid alias) are
  dropped with a per-row warning rather than failing the row. `x` reads as false,
  paired with `✓`.
- Pool column is mapped and shown but not stored: pool membership comes from
  `zpool status`, and there is no inventory field for it. The contract's pool column
  and pool filter on `/disks` are left out because `DiskSummary` has no pool; needs the
  `membership` field suggested above.
- Matching: model-serial key, then `findDiskBySerial` (the `Disk.serial` column, or a
  `DiskKey` value ending in the serial at a `|`, `_`, `-` or space boundary, `WD-`
  stripped as in `normaliseModelSerial`), then alias. A serial matching several disks,
  or an alias match whose stored serial differs, is skipped with a reason rather than
  merged. Serial-only disks created by an import have no `DiskKey`, so the `Disk.serial`
  lookup is what makes a second import idempotent.
- Matched rows overwrite the inventory keys the row provides and fill `model`, `serial`,
  `capacityBytes` only when null. Alias is set only when the disk has none and the alias
  is free (warning otherwise).
- Diary `imported` events are written only when a matched row changed something (and
  always for created disks), so re-importing the same table adds no diary noise.
- Status SPARE/REMOVED on a created disk becomes its `stateOverride`, so an Obsidian
  REMOVED disk shows `removed`, not `unseen`.
- Real imports run in one transaction; dry runs in a transaction rolled back by a
  sentinel error, so the preview is exact (created ids in a preview are not links).
- `/disks`: expired warranties show `expired` in dimmed text, not `error`: 008 keeps
  alarm for failing hardware, and an expired warranty needs no action. Under 90 days is
  amber. Filtering is client-side over `GET /api/disks`; sorting is TanStack with
  `sortUndefined: "last"` so unaliased and unknown values sit last in both directions.
- `/diary`: days are grouped and times shown in UTC (matches `formatDate`, avoids SSR
  hydration drift). Kind is filtered client-side as `GET /api/diary` has no kind
  parameter. `?subjectType=&subjectId=` pre-fills and opens the new-entry slideover.
