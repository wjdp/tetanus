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

### Server (Phase 7 server agent)

Response shapes for the UI (dates are ISO strings over the wire):

- `GET /api/disks/:id/smart` → `SmartOverview`:
  `{ reading, attributes: LatestAttribute[], history, selfTests: SelfTestRow[],
  acceptances: FaultAcceptanceRow[] }`.
  - `LatestAttribute` gains `displayStatus: AttributeDisplayStatus`
    (`passed | warning | failed | accepted`) and `acceptance: { id, acceptedValue,
    acceptedAt, note } | null` (the active acceptance only). `status` stays the
    un-overlaid status.
  - `SelfTestRow`: `{ id, diskId, type, status, passed, lifetimeHours, lba, seenAt }`,
    newest first by `lifetimeHours`.
  - `FaultAcceptanceRow`: `{ id, diskId, attrId, acceptedValue, acceptedAt, note,
    supersededAt, clearedAt }`, active and historical, newest `acceptedAt` first.
- `POST /api/disks/:id/accept` `{ attrId, note? }` → 201 `FaultAcceptanceRow`; 409
  already active; 404 unknown disk or attribute not in the latest reading; 400 bad
  body. `DELETE /api/disks/:id/accept/:attrId` → 200 `FaultAcceptanceRow` with
  `clearedAt`; 404 when none active.
- `DiskSummary.membership` / `DiskDetail.membership`: `{ poolId, poolName, vdevName,
  groupName, groupType, vdevState } | null`. `vdevName` is the leaf vdev name as ZFS
  reports it (e.g. `/dev/disk/by-vdev/K2-part1`); `groupName`/`groupType` come from
  the parent vdev (`raidz1-0`/`raidz1`, or the pool's `root` vdev for a top-level
  disk), null without a parent.
- `PATCH /api/diary/:id` `{ title?, body?, at? }` → 200 updated `DiaryEntryRow`;
  `DELETE /api/diary/:id` → 204. Both 403 for auto entries, 404 missing, 400 invalid.
  Schemas `diaryEntryPatchSchema`, `diaryParamsSchema` in `shared/schemas/diary.ts`.

New diary `eventType`s: `fault-accepted` (`{ attrId, acceptedValue, trend, note }`),
`acceptance-cleared` (`{ attrId, acceptedValue }`), `acceptance-superseded`
(`{ attrId, acceptedValue, value }`), `attribute-status-changed` (`{ attrId, name,
from, to, value }`), `disk-appeared` (`{ hostId, devicePath }`), `scrub-finished`,
`resilver-finished` (same data as `scan-finished`).

Decisions:

- `overlayStatus`, `effectiveDeviceStatus` and `healthStatus` live in
  `shared/smart/status.ts` (pure, usable by the UI) rather than the acceptance
  service. `healthStatus(smartPassed, exitStatus)` rebuilds the self-assessment from
  the stored reading (bit 3 of the exit status = disk failing), so the ingest path
  and the accept/clear recompute share one rule.
- Accept/clear recompute updates both `Disk.latestStatus` and the latest
  `SmartReading.deviceStatus`, so `reading.deviceStatus` in the overview agrees with
  the disk. `smart-status-changed` `failing`/`warning` lists exclude accepted
  attributes.
- Supersession and `attribute-status-changed` only run for the newest reading; a
  late, older reading changes neither.
- Accepting a `passed` attribute is allowed (the UI only offers it on
  `failed`/`warning`); it simply has no effect on status.
- K2's fixture only fails 197 (198 at 18 is not failed), so accepting 197 takes K2
  from `failed` to `passed`.
- `acceptance.ts` and `smart.ts` import each other (function-level only).
- `server/services/importers/obsidian.test.ts` (outside the owned list) now expects
  `disk-appeared` on a disk created by a sighting before import, and asserts the
  importer's own inserts emit none.

### UI (Phase 7 UI agent)

Built: accept/clear on attribute rows (neutral outline "accepted" badge, tooltip with
value and date, note shown in the expanded row), `AcceptFaultModal`, status line with
"· N accepted", self-tests table, membership from `DiskDetail.membership`, pool column
and filter on `/disks`, `DiaryMarkdown`, edit (slideover) and delete (confirm) on manual
entries in `DiaryTimeline`, used on `/diary`, the disk page and the pool Diary tab;
ISO/24-hour chart axes and legend.

Decisions and deviations:

- The accept modal fetches `/api/disks/:id/smart?range=all` itself, so the 7 d and 30 d
  references and the "for N days" duration are not cut off by the page's range tab
  (the 30 d reference would otherwise miss at the 7d range). Ages are measured from the
  attribute's `takenAt`, not the wall clock.
- The duration runs from the start of the trailing run of points equal to the current
  value, not the earliest equal point anywhere, so 16 → 12 → 16 reports the latest run.
  History is downsampled to 500 points server-side, so the start is approximate.
- `accepted` is neutral everywhere; toasts for accept/clear/edit/delete are neutral
  (success is reserved for recovery per 008).
- The membership card lost the read/write/checksum counters and the host name: neither
  is in `membership`. The pool page still shows them.
- Timeline sorts entries newest first itself and has `showSubject` (off on the disk and
  pool pages). Diary times in the timeline and the edit field are UTC; chart axes use the
  browser's local time (uPlot places ticks in local time).
- A generic `app/components/ConfirmModal.vue` serves both clear and delete.
- Diary bodies render with `breaks: true` so single newlines in older plain-text entries
  still break.

Left out:

- No component test for `AcceptFaultModal` itself (UModal needs the UApp overlay
  provider); its maths is covered in `app/utils/acceptanceSummary.test.ts`.
- No UI for the acceptance history (`acceptances`, superseded/cleared rows); the diary
  carries those events.
- Markdown links open in the same tab and get no `rel`; bodies are single-user content.
