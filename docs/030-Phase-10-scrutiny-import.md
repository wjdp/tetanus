---
type: task
status: todo
---

# Phase 10 scrutiny import

Phase 10 of the [project plan](004-Project-plan.md): one-off import of scrutiny's
device registry and SMART history so history is not lost at cut-over. Background in
[002](002-Prior-art-and-problem-space.md) §Scrutiny. Decisions agreed 2026-09-28: read
scrutiny's REST API (no Influx token, no SQLite file); per disk import only points
older than tetanus's first reading; scrutiny is reachable on the LAN.

## Contract

### Source: scrutiny's web API

Unauthenticated JSON, all under `<url>/api`:

| endpoint | gives |
| --- | --- |
| `GET /summary` | `data.summary: { <scrutiny_uuid>: { device, smart?: { collector_date, temp, power_on_hours }, temp_history? } }`; `device` has `scrutiny_uuid, wwn, device_name, model_name, serial_number, firmware, capacity, rotational_speed, form_factor, device_protocol (ATA\|NVMe\|SCSI), device_type, interface_type, host_id, label, archived, device_status (bitmask), UpdatedAt, CreatedAt` |
| `GET /device/:uuid/details?duration_key=forever` | `data.device`, `data.smart_results[]`: `{ date, device_protocol, temp, power_on_hours, power_cycle_count, attrs: { <id>: { attribute_id, value, thresh, worst, raw_value, raw_string, when_failed, transformed_value, status, failure_rate? } } }`, one point per day (scrutiny aggregates to 24 h server-side), newest first, unioned across its four retention buckets |
| `GET /summary/temp?duration_key=forever` | `data.temp_history: { <uuid>: [{ date, temp }] }` |

NVMe/SCSI `attrs` are keyed by name (`media_errors`) and lack `worst`, `raw_*`,
`when_failed`. `date` is RFC 3339. Capture one response of each shape from mars's
scrutiny into `test/fixtures/scrutiny-api/` (scrub serials and WWNs with
`bin/scrub-fixtures.py`, same fakes as the mars fixtures so a device joins a fixture
disk). The user captures; until then the service tests use hand-built minimal JSON.

### Service (`server/services/importers/scrutiny.ts`)

`importScrutiny({ url, hostId, dryRun })`, run as queue task `import:scrutiny` (Nitro
queue in `server/tasks/queueable/`), progress reported through the existing task
`progress`/SSE mechanism as `n / total devices`. Steps per device, in one transaction
per device:

1. **Match a Disk**: `Disk.scrutinyUuid`, else `(model, serial)` (scrutiny's
   `model_name` vs `Disk.model`, `serial_number` vs `Disk.serial`, trimmed,
   case-insensitive), else `DiskKey` `wwn` from `device.wwn` (strip `0x`). Set
   `scrutinyUuid` on a match if empty. No match → create an inventory-only Disk with
   `model, serial, firmware, capacityBytes, rotationRate, protocol (lower-case),
   transport = interface_type, formFactor, scrutinyUuid`, `lastSeenAt = device.UpdatedAt`,
   `lastSeenHostId = hostId`, `firstSeenAt = CreatedAt`, no `DiskKey` rows except `wwn`
   when present. `lastState` left null; state inference will call it `removed`/`unseen`
   as the missing rules decide. Diary `imported-from-scrutiny` on the disk with the
   counts.
2. **Cut-off**: `cutoff = min(earliest SmartReading.takenAt, earliest
   TemperatureReading.at)` for the disk, or `+inf` when none. Only points with
   `date < cutoff` are written.
3. **SMART**: each `smart_results` point → one `SmartReading` (`hostId`, `takenAt =
   date`, `devicePath = device_name`, `deviceType = device_type`, `smartPassed = null`,
   `exitStatus = null`, `temp`, `powerOnHours`, `powerCycles`, `deviceStatus` from the
   attributes via the existing evaluator) and its `SmartAttribute` rows. Do **not**
   trust scrutiny's `status`/`failure_rate`: rebuild a minimal parsed reading and run
   `evaluateReading`-equivalent per attribute through `shared/smart/evaluate.ts` so one
   policy applies (see `recordSmartReading` in `server/services/smart.ts`; extract the
   attribute evaluation so both callers share it). `name` from `attributeName`.
   Skip a point whose `takenAt` already has a reading for the disk.
4. **Temperature**: `temp_history` points plus every SMART point's `temp` →
   `TemperatureReading`, `onConflictDoNothing` on `(diskId, at)`.
5. **Disk.latest\***: untouched (imported data is older by construction). `recomputeLatestStatus` not needed.
6. **Self-tests, acceptances**: not imported (scrutiny has neither).

Result `{ devices: [{ uuid, model, serial, matched: "uuid" | "serial" | "wwn" | "created",
diskId, readings, temperatures, skipped }], cutoffs }`. `dryRun` does the fetch and
matching, writes nothing, returns the same shape with what would be written.

Errors: unreachable URL or non-`success` body → `ServiceError(502, ...)`; a device
whose details call fails is recorded in the result and skipped, not fatal.

### Coarse data

Everything imported is at best one point per day and older than tetanus's own data.
Mark it: `SmartReading.source: text` (`"collector"` default, `"scrutiny"` for imports;
migration `smart_reading_source`). The disk page shows a note above charts when any
imported reading is in range: "Readings before <date> were imported from scrutiny at
daily resolution". `getSmartHistory` passes `source` through.

### API and UI

- `POST /api/import/scrutiny` `{ url, hostId, dryRun }` (zod in
  `shared/schemas/import.ts`): `dryRun=true` runs inline and returns the preview;
  `dryRun=false` enqueues `import:scrutiny` and returns `{ taskId }`. The task result
  carries the summary.
- Settings › Import page: second card "Scrutiny" with URL (default
  `http://mars:8080`), target host select (from `/api/hosts`), Preview → table of
  devices (model, serial, match, points to import, cut-off), Import → task progress via
  the existing task indicator, then the summary table.
- Settings page for the import stays at `/settings/import`.

### Cut-over (user, not code)

Run the preview then the import against mars's scrutiny; verify a disk page shows the
long history; stop the scrutiny containers. Record the date in 004.

## Steps

1. Fixtures (user) + zod schema + client for the three endpoints
   (`server/services/importers/scrutinyApi.ts`, pure fetch with 30 s timeout, typed).
2. Matching and inventory-row creation, tests.
3. Shared attribute evaluation extracted from `recordSmartReading`; reading and
   temperature import with cut-off; `source` column and migration; tests.
4. Queue task, route, Settings › Import card, disk-page note.
5. Update 004 (Phase 10 done, cut-over date).

## Out of scope

- Scrutiny's notification settings, labels, `archived` flag semantics (archived devices
  are imported like any other; they become inventory rows).
- Importing scrutiny's sticky device status.
- The scrutiny-collector adapter routes (Later in 004).

## Findings

(agents append here)
