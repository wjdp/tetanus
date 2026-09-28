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
