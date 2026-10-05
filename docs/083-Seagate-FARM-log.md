---
type: task
status: done
---

# Seagate FARM log

Follows up the FARM notes in
[031](031-Vendor-detection-and-vendor-specific-inventory-fields.md),
[080](080-Vendor-override-warranty-check-links-and-vendor-SMART-hints.md) and
[081](081-Power-on-hours-counter-wraparound.md).

## Problem

Seagate's FARM log (Field Accessible Reliability Metrics) keeps its own power-on hours,
power-cycle count, serial and WWN, apart from the SMART attributes. Grey-market and
"recertified" Seagates have had SMART wiped to look new; FARM survives the wipe, so
comparing the two is the standard check. tetanus doesn't collect FARM, so it can't
make that check.

## Context

- `--xall` only probes for FARM: the JSON carries `seagate_farm_log: {supported: bool}`
  and no data. The log needs `-l farm` (smartctl 7.4+, marked experimental).
  `--xall --json` fixtures from mars report `supported: true` on all six Exos drives
  and false on everything else.
- Checked by hand on mars, 2026-10-05, smartctl 7.5:
  `smartctl -x -l farm --json -n standby`
  - A Seagate SATA drive: full `seagate_farm_log` with `page_0_log_header` …
    `page_5_reliability_statistics`. Same exit status as its existing xall fixture, so
    the extra flag adds no exit bits.
  - A WD drive: `seagate_farm_log: {supported: false}`, exit 0. On unsupported
    drives the flag does nothing.
  - Page 5 is mostly per-head keys (heads × ~8 metrics), which makes up most of the
    extra payload. It lands in `Disk.latestRaw` with the rest of the reading.
- Page 1 fields that matter: `poh`, `spoh` (spindle), `head_flight_hours`,
  `power_cycle_count`, `serial_number`, `world_wide_name`, `date_of_assembly`
  (empty on the drive checked), `drive_recording_type` (CMR/SMR).
- A known grey-market drive in the fleet shows the wipe pattern:
  - FARM `poh` is about twice SMART attribute 9.
  - FARM `power_cycle_count` is several times SMART attribute 12.
  - FARM `spoh` and `head_flight_hours` match SMART and device statistics exactly.

  So the wipe rewrote spindle and head hours too. Only `poh` and power cycles give
  it away, which means the check has to compare those and not `spoh`.
- The collector already reads `smartctl --version` (`host/tetanus-collect`), and
  `shared/hostTools.ts` sets the smartmontools minimum at 7.0.

## Step 1: collect and capture

- `host/tetanus-collect` `collect_smartctl_xall`: append `-l farm` when smartctl is
  7.4 or newer. Older versions reject the flag and the whole reading would be lost.
  Same `smartctl-xall` source; no server change needed to receive it.
- `host/test/collect.test.sh`: cover both sides of the version gate.
- `bin/capture-fixtures.sh`: add `-l farm` to the xall captures.
- Deploy to mars and recapture `test/fixtures/mars/smartctl/`. Check that
  `bin/scrub-fixtures.py` catches the FARM copies (`page_1_drive_information.serial_number`,
  and `world_wide_name` in its bare `0x5…` form) before committing.
- Check that existing parser and seeded tests still pass on the new fixtures.

## Step 2: use the data

Fleet check on the re-captured fixtures (six SATA Exos):

| FARM log version | Drives | FARM `poh` − SMART 9 | FARM − SMART 12 cycles | `date_of_assembly` |
|---|---|---|---|---|
| 4.x | 4 | 0–1 h | 1 | `YYWW`, e.g. `2203` |
| 3.7 | 2 (same model) | ~2× SMART | 1.7–3.7× | empty |

Both 3.7 drives are known grey-market. On both, FARM `poh` is close to 2× SMART, and
FARM `spoh` matches SMART, which raised the question of whether 3.x counts `poh` at
twice the rate. Settled 2026-10-06: over several hours FARM `poh` and SMART hours on
one of them advanced at the same rate. So the gap is a real reset, and 3.x is compared
like 4.x (the wipe evidently rewrote `spoh` too).

### Parse

- `server/ingest/smartctl-xall.ts`: `farm?: SeagateFarm` on `SmartctlXallResult`, only when
  `seagate_farm_log` has page data. The type lives in `shared/smartctl.ts`:
  - `logVersion`
  - page 1: `powerOnHours`, `spindleHours`, `headFlightHours`, `headLoadEvents`,
    `powerCycles`, `serial` (trimmed), `wwn`, `recordingType`, `heads`,
    `assembledOn` (`YYWW` → ISO week string, null when empty)
  - page 2: read/write commands, random reads/writes, sectors read/written
  - page 3: unrecoverable read/write errors, reallocated and candidate sectors, ASR
    events, CRC errors, command timeouts
  - page 4: observed temperature highest/lowest/average (`max_temp`/`min_temp` are spec
    limits, not observations), 12 V and 5 V current/min/max (0 means not reported)
  - page 5: `heliumPressureTrip`
  - per head, arrays of length `number_of_heads`: MR head resistance, reallocated
    sectors, reallocation candidates, write-workload power-on time (unit unknown: it
    exceeds `poh`, so don't call it hours), cumulative unrecoverable reads (repeating
    and unique), skip-write detections
- SAS: smartctl's SCSI FARM JSON uses different keys. Take them from smartmontools'
  `farmprint.cpp` (not from memory), use a synthetic fixture, and label it untested
  against hardware.
- FARM WWN is `0x…`, while `identity.wwn` is bare lowercase hex, so normalise before
  comparing. Key names in the fixtures are misspelled (`curent_temp`,
  `helium_presure_trip`); use them as they are.

### Store

- New `Disk.latestFarm` json column, from migration `disk_latest_farm`. It's written in
  `recordSmartReading`'s `isLatest` branch like `ataSsdAttributes`, so standby readings
  leave it alone. A reading without FARM leaves the last one in place.
- It stays on `DiskSummary` (about 3 KB per Seagate) so the detector can read it.
- `getSmartOverview` exposes it for the FARM section and `DiskDetail` for the headline.
- No backfill. The next hourly reading fills it.
- Add a Seagate Exos template to the demo (`server/demo/smartTemplates.ts`) so seeded
  tests and the demo include FARM.

### Fault

- New kind `smart-counters-reset`: disk, persistent, warning (amber), key `diskId`. The
  only way to deal with it is to accept it (decided 2026-10-05). Acceptance is
  level-based on the gap in hours, so a later, bigger reset reopens it.
- Raised when FARM log version is 3+ and FARM `poh` − SMART power-on hours > max(48 h,
  5% of FARM `poh`). Skipped when SMART hours look wrapped (081): FARM above 65,535
  and SMART below it. On the
  fleet that's 0–1 h for healthy drives and thousands for wiped ones. Also raised when
  the FARM serial or WWN differs from the drive's (after trimming).
- The title gives FARM and SMART hours, e.g. "SMART reset: FARM 43,908 h, SMART 22,299 h".
- Diary: the existing fault diary entries are enough, so it isn't diary-silent.
- Wiring:
  - `FAULT_KINDS` and the kind definitions in `shared/faults.ts`
  - the detector list in `server/services/faults.ts`
  - an alert rule, or listing it in `FAULT_KINDS_WITHOUT_ALERT_RULE`
  - `SMART_FAULT_KINDS` in `app/utils/vocabulary/fault.ts`, so it links to the SMART tab
  - both tables in [036](036-Faults-page.md)
  - backfill isn't needed: the final sync recomputes it

### Show

- Disk page headline figures: when FARM is present and disagrees, power-on hours shows
  FARM hours next to SMART hours.
- `DiskSmart.vue`: a "Seagate FARM" section, only when `latestFarm` is present:
  - fact group: log version, power-on, spindle and head-flight hours, power cycles,
    head load events, recording type, assembly week, helium trip
  - fact group: workload (random vs sequential share, totals), errors, voltages
  - per-head table: one row per head with resistance, reallocated, candidates,
    unrecoverable reads, write hours. Flag heads that stand out from the median
    (resistance more than 20% off, any reallocations), with no fault attached
- Inventory: `assembledOn` fills in where the inventory has no manufacture date. There
  is no such field yet, so only show it on the page for now.

### Out of scope

- Alerts or faults on per-head values.
- Keeping FARM history (only the latest is stored).
- `recordingTech` auto-fill from `drive_recording_type`. Data model 031 owns that.

## Decisions

- smartmontools minimum stays 7.0; FARM is gated on 7.4+ (2026-10-05).
- FARM is shown inside the SMART view, not on its own tab, so a disagreement sits next
  to the SMART figure it contradicts. Reversed by [084](084-Statistics-tab.md): FARM moves to
  the Statistics tab, and the fault and power-on headline keep the disagreement visible.

## Status

Done (2026-10-06). Left over:

- SAS mapping is untested against hardware. Capture a fixture when a SAS Seagate turns up.
