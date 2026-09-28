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

Unauthenticated JSON, all under `<url>/api`. Verified 2026-09-28 against the live
instance at `https://scrutiny.wjdp.uk` (26 devices, 25 ATA + 1 NVMe): this scrutiny
version keys devices by **WWN**, not `scrutiny_uuid`; the summary map key, the details
path parameter and `smart_results[].device_wwn` are all the `0x…` WWN string, and
`scrutiny_uuid` is absent. Code must accept either key (`scrutiny_uuid ?? wwn`).

| endpoint | gives |
| --- | --- |
| `GET /summary` | `data.summary: { <wwn>: { device, smart?: { collector_date, temp, power_on_hours }, temp_history? (last week) } }`; `device` has `wwn, device_name, model_name, serial_number, firmware, capacity, rotational_speed, form_factor, device_protocol (ATA\|NVMe\|SCSI), device_type, interface_type (empty on the live host), host_id, label, archived, device_status (bitmask), UpdatedAt, CreatedAt`, plus `scrutiny_uuid` on newer versions |
| `GET /device/:wwn/details?duration_key=forever` | `data.device`, `data.smart_results[]`: `{ date, device_wwn, device_protocol, temp, power_on_hours, power_cycle_count, Status, attrs: { <id>: { attribute_id, value, thresh, worst, raw_value, raw_string, when_failed, transformed_value, status, failure_rate? } } }`, newest first, aggregated to one point per day server-side and unioned across the four retention buckets. Live: 26 points per disk spanning 2025-01-01 to now, so the older buckets are monthly at best |
| `GET /summary/temp?duration_key=forever` | `data.temp_history: { <wwn>: [{ date, temp }] }`; live: 86 points per disk from 2025-10-01 |

NVMe/SCSI `attrs` are keyed by name (`media_errors`) and lack `worst`, `raw_*`,
`when_failed`. `date` is RFC 3339. Capture one response of each shape from mars's
scrutiny into `test/fixtures/scrutiny-api/` (scrub serials and WWNs with
`bin/scrub-fixtures.py`, same fakes as the mars fixtures so a device joins a fixture
disk). The agent captures them with curl from the live instance above; keep
`smart_results` to a handful of points per fixture.

### Service (`server/services/importers/scrutiny.ts`)

`importScrutiny({ url, hostId, dryRun })`, run as queue task `import:scrutiny` (Nitro
queue in `server/tasks/queueable/`), progress reported through the existing task
`progress`/SSE mechanism as `n / total devices`. Steps per device, in one transaction
per device:

1. **Match a Disk**: `DiskKey` `wwn` from `device.wwn` (strip `0x`, lower-case), else
   `Disk.scrutinyUuid` when the payload carries one, else `(model, serial)` (scrutiny's
   `model_name` vs `Disk.model`, `serial_number` vs `Disk.serial`, trimmed,
   case-insensitive, collapse repeated spaces: scrutiny has `WDC  WDS500G2B0A`). Set
   `scrutinyUuid` on a match if empty and the payload has one. No match → create an inventory-only Disk with
   `model, serial, firmware, capacityBytes, rotationRate, protocol (lower-case),
   transport = interface_type or null, formFactor, scrutinyUuid?`, `lastSeenAt = device.UpdatedAt`,
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

Result `{ devices: [{ key (wwn or uuid), model, serial, matched: "wwn" | "uuid" | "serial" | "created",
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
- Settings › Import page (`/settings/import`, re-added to `SETTINGS_NAVIGATION`; the
  Obsidian importer that used to live there was removed 2026-09-28): one card
  "Scrutiny" with URL (default `https://scrutiny.wjdp.uk`), target host select (from `/api/hosts`), Preview → table of
  devices (model, serial, match, points to import, cut-off), Import → task progress via
  the existing task indicator, then the summary table.
- Development can run against the live instance at `https://scrutiny.wjdp.uk`
  (read-only GETs; nothing there is modified).

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

### Importer

Steps 1–3 done (fixtures, client, evaluation extraction, `source` column, importer).

```ts
// server/services/importers/scrutiny.ts
importScrutiny(options: {
  url: string;
  hostId: number;
  dryRun: boolean;
  fetchImpl?: typeof fetch;
  onProgress?: (done: number, total: number) => void;
}): Promise<ScrutinyImportResult>

interface ScrutinyImportResult {
  dryRun: boolean;
  devices: {
    key: string;                 // summary map key: wwn (0x…), NVMe serial, or scrutiny_uuid
    model: string;
    serial: string;
    matched: "wwn" | "uuid" | "serial" | "created";
    diskId: number | null;       // null for a dry-run creation or a failed device with no match
    cutoff: Date | null;         // null = no tetanus data, everything imported
    readings: number;            // SMART points written (or to write)
    temperatures: number;        // temperature points written (or to write)
    skipped: number;             // SMART points at/after the cut-off
    error?: string;              // details call failed; device skipped
  }[];
}
```

Throws `ServiceError(404)` for an unknown `hostId`, `ServiceError(502)` when the summary
or temperature call fails, `ServiceError(400)` for an unparseable URL. Client:
`createScrutinyClient(url, fetchImpl)` in `scrutinyApi.ts` (`summary()`,
`details(key)`, `temperatureHistory()`); `scrutinyFixtureFetch()` serves
`test/fixtures/scrutiny-api` for tests.

Live instance observations (2026-09-28):

- The NVMe disk has no WWN: its `wwn` field, map key and `device_wwn` are its
  **serial** (`183356800333`), no `0x`. Only a `0x…` value is treated as a WWN;
  anything else matches by model and serial.
- `device_serial_id` carries `scsi-3<wwn>`; `interface_type`, `host_id`, `label`,
  `device_uuid` are empty; `CreatedAt` is sometimes `+01:00`, nanosecond precision.
- Each details response carries a top-level `metadata` (scrutiny's attribute
  metadata), ignored. ATA attrs also carry `status_reason`.
- The newest SMART point is the live one (e.g. `21:23:01.16Z`); the rest are midnight
  aggregates. The unmatched fixture disk has a single point.
- `device_status` 2 (failed by scrutiny) on 5 disks; mars `sdb` (fixture
  `details-ata.json`) has 197/198 raw 16 from 2026-08-31, which our evaluator also
  fails (Current Pending Sector Count, failure rate 0.61).

Decisions:

- `SmartHistory` gains `importedUntil: Date | null` (newest imported reading in range)
  for the disk-page note; attribute points gain `source: "scrutiny"` only when
  imported (collector points unchanged, so the payload and existing tests stay as
  they were). `reading.source` also appears on the overview's latest reading.
- Shared evaluation in `smart.ts`: `evaluateNamedAttributes(parsed)` (used by
  `recordSmartReading`), `evaluateMinimalReading({ protocol, attributes, temperature,
  powerOnHours, powerCycles })` (builds a minimal `SmartctlXallResult`: ATA by numeric
  id, NVMe by snake_case name → nvme log, SCSI by name → `ScsiInfo`), and
  `insertSmartReading(values, attributes)`. Imported `deviceStatus` is the worst
  attribute status (no overall SMART verdict, no acceptance overlay); `unknown` with no
  attributes.
- Model+serial matching tries the `model-serial` DiskKey first (handles `WD-` and
  INQUIRY truncation), then `Disk.model`/`serial` compared trimmed, case-insensitive,
  whitespace collapsed (catches inventory-only disks, which have no model-serial key).
- Inventory-only disks are inserted directly (not via `observeDisk`, which needs keys,
  uses one timestamp for first/last seen and writes `disk-appeared`); they also get
  `lastDevicePath` (`/dev/<device_name>`) and `lastDeviceType`. `latestStatus` is the
  column default `unknown`.
- Cut-off and temperatures: temperatures use the same cut-off as SMART points. Sources
  are the forever temp history, the summary's recent `temp_history` and each SMART
  point's `temp`, deduped by time. Because the cut-off is the earliest existing reading,
  "skip a point whose takenAt already has a reading" is implied and not coded
  separately. A second import finds its own earlier data and writes nothing.
- A disk with nothing to write (matched, all points after the cut-off) gets no diary
  entry. Diary data: `url, key, matched, readings, temperatures, skipped, cutoff`.
- Top-level `cutoffs` from the contract became a per-device `cutoff`.
- Fixtures reuse `bin/scrub-fixtures.py`'s `fake_serial`/`fake_hex` with the default
  salt on the scrutiny originals (the script's discovery walks collector files, not
  scrutiny JSON); the fakes match `test/fixtures/mars`. Written compact, as scrutiny
  sends them.

Open: inventory-only disks get only a `wwn` key per the contract, so an NVMe disk
(no WWN) created by import would not merge with a later collector sighting of it; a
`model-serial` key would fix that.
