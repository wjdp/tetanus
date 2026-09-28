---
type: task
status: todo
---

# Phase 7 diary and fault acceptance

Phase 7 of the [project plan](004-Project-plan.md): fault acceptance with the overlay
from [003](003-Architecture-and-data-model.md) §SMART evaluation, diary editing and
markdown, the remaining auto events, and the API gaps Phase 6 recorded.

## Contract

### Fault acceptance

Table `FaultAcceptance`: id, diskId FK cascade, attrId text, acceptedValue int (the
`transformedValue` at acceptance), acceptedAt datetime, note text default '',
supersededAt datetime nullable, clearedAt datetime nullable; index(diskId, attrId).
"Active" = `supersededAt IS NULL AND clearedAt IS NULL`; at most one active per
(disk, attr), enforced in the service.

Overlay, applied wherever attributes or a disk status are read:

- Active acceptance and the attribute's current `transformedValue <= acceptedValue` →
  display status `accepted`. `AttributeDisplayStatus = AttributeStatus | "accepted"`
  in `shared/smart/status.ts`.
- Value rises above `acceptedValue` on a new reading → mark `supersededAt`, diary
  `acceptance-superseded` on the disk (`data: { attrId, acceptedValue, value }`), the
  attribute shows its real status again.
- Disk status (`SmartReading.deviceStatus`, `Disk.latestStatus`) = worst of
  `smartStatus.passed` and the statuses of attributes **not** covered by an active
  acceptance. Stored statuses therefore change when an acceptance is created or
  cleared: recompute `Disk.latestStatus` from the latest reading at that moment and
  write `smart-status-changed` if it moved.
- Routes: `POST /api/disks/:id/accept` `{ attrId, note? }` → 201 with the acceptance;
  409 when one is already active. `DELETE /api/disks/:id/accept/:attrId` → clears
  (`clearedAt`), diary `acceptance-cleared`. Accepting writes diary `fault-accepted`
  (`data: { attrId, acceptedValue, trend, note }`). `GET /api/disks/:id/smart` gains
  `acceptances: FaultAcceptance[]` (active and historical, newest first) and each
  attribute gains `displayStatus` and `acceptance: { id, acceptedValue, acceptedAt,
  note } | null`.

### Auto events still missing

- `attribute-status-changed` on the disk when an attribute's (un-overlaid) status
  differs from the same attribute in the previous reading: `data: { attrId, name,
  from, to, value }`. One entry per attribute per change; nothing on the first reading.
- `disk-appeared` when `observeDisk` creates a row from a sighting (not the importer).
- `resilver-finished` and `scrub-finished` replace the generic `scan-finished`
  (`scan.function` `RESILVER` vs `SCRUB`); keep `scan-finished` for anything else.

### Diary

- `PATCH /api/diary/:id` `{ title?, body?, at? }` and `DELETE /api/diary/:id`, manual
  entries only (403 for auto).
- Body is markdown. Render with `markdown-it` (`html: false`, `linkify: true`) in one
  component `app/components/diary/Markdown.vue`; used on `/diary`, the disk page and the
  pool page.
- Global timeline and per-subject timelines share one component; the disk and pool
  pages use it with edit/delete on manual entries.

### API gaps from Phase 6

- `GET /api/disks/:id/smart` gains `selfTests` (from `SelfTest`, newest first).
- `DiskSummary` and `DiskDetail` gain `membership: { poolId, poolName, vdevName,
  groupName, groupType, vdevState } | null` from the present vdev linked to the disk.
  `/disks` shows a pool column and filter from it; the disk page uses it instead of
  walking `/api/pools`.
- `@iconify-json/lucide` moves to `dependencies` so server-side icon lookups work in
  the built image.

### UI

- Attribute row on the disk page: an "Accept" action on `failed`/`warning` rows opening a
  modal with the attribute's name and description, current value with unit, trend
  chip, the 7 d and 30 d reference values from history (e.g. "16 for 14 months, stable"
  when the earliest point in the available history equals the current value), the
  failure rate, a note field; confirm POSTs the acceptance. Accepted rows show a
  neutral "accepted" badge with the accepted value and date, and a "Clear" action.
  The device status line counts only un-accepted faults.
- Diary entries: manual entries get edit (inline slideover) and delete (confirm)
  actions; auto entries none.

## Findings

(agents append here)
