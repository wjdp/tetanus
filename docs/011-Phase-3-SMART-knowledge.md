---
type: task
status: todo
---

# Phase 3 SMART knowledge

Phase 3 of the [project plan](004-Project-plan.md): vendor scrutiny's attribute
knowledge, port its evaluation, persist readings. Design in
[003](003-Architecture-and-data-model.md) §SMART evaluation; scrutiny notes in
[002](002-Prior-art-and-problem-space.md). Contract first, findings at the bottom.

## Contract

### Metadata

`bin/generate-smart-metadata.ts` (tsx, one file) reads a scrutiny checkout
(`--scrutiny <path>`, default `../scrutiny`) and writes `shared/smart/metadata.json`:

```
{ "_source": "<repo>@<sha>", "ata": { "<id>": { displayName, ideal, critical, description, displayType, transformValueUnit?, observedThresholds?: [{ low, high, annualFailureRate }] } },
  "nvme": { "<key>": { displayName, ideal, critical, description } },
  "scsi": { "<key>": { displayName, ideal, critical, description } } }
```

Parsed from the Go source with regexes, not hand-copied. `error_interval` dropped.
Commit the JSON; the generator is for refreshing it. Scrutiny is MIT; keep the notice in
`test/fixtures/scrutiny/NOTICE.md` and add a line to it for the metadata.

### Evaluation (pure, `shared/smart/`)

- `transforms.ts`: 188 (Seagate three-piece raw string → last piece) and 194 (low byte).
  Keyed by attribute id; `transform(id, value, rawValue, rawString)` returns the raw
  value unchanged when no transform exists.
- `evaluate.ts`: `evaluateReading(parsed: SmartctlXallResult)` →
  `{ deviceStatus, attributes: EvaluatedAttribute[] }` where
  `EvaluatedAttribute = { attrId: string; name; value; worst?; thresh?; rawValue?; rawString?; whenFailed?; transformedValue; status: AttributeStatus; failureRate?; reason? }`.
  Statuses are the shared enums in `shared/smart/status.ts` (created in wave 1):
  attribute `passed | warning | failed`, device `passed | warning | failed | unknown`.
  Scrutiny's bitmasks collapse: `FailedSmart`/`FailedScrutiny` → `failed`,
  `WarningScrutiny` → `warning`. One threshold policy, no user filter.
- ATA per scrutiny `PopulateAttributeStatus` + `ValidateThreshold`, buckets inclusive,
  first match wins, value chosen by `displayType`.
- NVMe: the fixed table in scrutiny `ProcessNvmeSmartInfo` (thresholds 0, `-1`,
  `available_spare_threshold`, 100).
- SCSI: scrutiny's table in `ProcessScsiSmartInfo` **looked up against the SCSI
  metadata, not NVMe** (the bug in 002). Consequence: `smart-scsi.json` with 56 grown
  defects becomes `failed`, where scrutiny says passed. Assert the fixed behaviour.
- Device: `!smartStatus.passed` → `failed`; any failed attribute → `failed`; else any
  warning → `warning`; standby with no data → `unknown`.
- Tests: every fixture in `test/fixtures/scrutiny/expected.json` with a non-null entry,
  mapping the bitmasks to our enums, plus the SCSI divergence, plus mars
  `test/fixtures/mars/smartctl/*-auto.json` all evaluate without throwing.

### Persistence (`server/services/smart.ts`)

`recordSmartReading({ disk, hostId, meta, parsed, receivedAt })`, called from the
`smartctl-xall` ingest handler after Phase 4 has resolved the `Disk`:

1. Standby (`parsed.standby`) → no reading; touch `Disk.lastSeenAt` only.
2. Insert `SmartReading` + one `SmartAttribute` per evaluated attribute.
3. `TemperatureReading`: current temperature at `receivedAt`, plus SCT history
   backfilled with scrutiny's interval alignment (`t = receivedAt - i*interval`, floored
   to the interval; skip null/0), `INSERT OR IGNORE` on `(diskId, at)`.
4. `SelfTest` upsert on `(diskId, type, lifetimeHours)`.
5. `Disk.latestRaw` = the raw body, `latestStatus`, `latestTemp`,
   `latestPowerOnHours`, `latestPowerCycles`, `latestReadingAt`.
6. A change of `latestStatus` → diary auto event `smart-status-changed` on the disk.

`getSmartHistory(diskId, range)` for `GET /api/disks/:id/smart?range=7d|30d|1y`:
temperature series and per-attribute series (`transformedValue` over `takenAt`),
downsampled server-side to ≤ 500 points per series.

`trend(diskId, attrId)`: compare the latest `transformedValue` with the nearest reading
≥ 7 d and ≥ 30 d old → `new | stable | worsening | improving`. Returned with the disk's
attribute list.

## Findings

(agents append here)

### Metadata and evaluation (pure half)

- `_source`: `github.com/AnalogJ/scrutiny@4e9227146190ed81886e65d34e9584cccbc4ce96`.
  81 ATA, 16 NVMe, 13 SCSI entries; 130 ATA observed-threshold buckets on 16 attributes.
- ATA 174 has no `DisplayType` in scrutiny; Go's zero value falls through to raw, so the
  generator writes `"raw"`.
- smartctl JSON writes `when_failed` as `now`/`past`, but scrutiny compares against
  `FAILING_NOW`/`IN_THE_PAST`, so its when-failed branch never fires on JSON input. We
  accept both spellings; `smart-fail2.json` attr 5 is now `failed` via `now`.
- Device status diverges from scrutiny in three places, all asserted in tests:
  scrutiny's device bitmask has no warning bit, so its `0` is our `passed` or `warning`
  (`smart-ata.json` is `warning` from attr 3); `smart-fail.json` (open failed, no data)
  is `unknown` via standby, not `failed`; a missing `smart_status` is `unknown` rather than
  `failed` (scrutiny's Go zero value), lifted by any evaluated attribute, and
  `exitStatus.diskFailing` also forces `failed`. `smart-raid.json` (SCSI, no SMART data)
  is therefore `unknown` with 0 attributes.
- NVMe/SCSI fields absent from the log are skipped, not zero-filled (scrutiny always
  emits 16/13). `transformedValue` for NVMe/SCSI is the value (scrutiny leaves it 0).
  ATA `name` is smartctl's (drivedb-aware); metadata `displayName` via `attributeMetadata`.
- SCSI with the metadata fix: `smart-scsi.json` → `failed` on `scsi_grown_defect_list` 56.
- ATA ids in fixtures with no scrutiny metadata (evaluated `passed`, no failure rate):
  18 Head_Health, 23/24 Helium_Condition_Lower/Upper, 27 MAMR_Health_Monitor,
  245 (Timed_Workld_Media_Wear / Percent_Life_Remaining / Unknown_Attribute),
  246 Timed_Workld_RdWr_Ratio, 247 Timed_Workld_Timer.
- mars is not all green. `failed`: sdb (197 Current_Pending_Sector raw 16, critical, AFR
  ≥ 10%; also 198 raw 18 critical with no bucket → warning), sdj (187 Reported_Uncorrect
  raw 1). `warning`: sdd, sde, sdf, sdg, sdh, sdi, sdk, sdl from 3 Spin-Up Time
  (normalised 81–93, bucket 78–96 AFR 11%) and/or 4 Start/Stop Count (raw 35–85, AFR
  11–16%); sdn, sdp from 201 (critical, raw outside every bucket). `passed`: sda, sdc,
  sdm, sdo, sdq, sdr, sds, nvme0. The 3/4 warnings are Backblaze population statistics,
  not faults; worth reviewing whether non-critical warnings should reach device status.
- `shared/smart/evaluate.test.ts` imports the parser from `server/` by relative path;
  Biome's restricted-imports pattern only matches aliases, so it passes lint.
