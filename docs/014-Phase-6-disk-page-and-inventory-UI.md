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
