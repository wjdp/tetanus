---
type: task
status: in-progress
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

Scope once the step 1 fixtures are in.

- Parse page 1 in `server/ingest/smartctl-xall.ts` into a typed `farm` block on the
  reading.
- A fault, or a diary entry, when SMART and FARM disagree: `poh` against attribute 9,
  `power_cycle_count` against attribute 12, serial, WWN. Thresholds come from the
  fleet fixtures, not guessed.
- Show FARM hours on the disk page next to SMART power-on hours.
- Maybe: `drive_recording_type` to back up the `recordingTech` inventory field, and
  the assembly date where it's present.
- SAS Seagates are in scope (their FARM log is a SCSI log page with a different
  layout), but no SAS Seagate is in the fleet. Build from smartmontools' JSON keys
  plus a synthetic fixture, and flag it as untested against hardware.
- Out of scope: per-head metrics and pages 2–5 apart from what a fault needs.

## Questions

1. Raise the smartmontools minimum to 7.4, or keep 7.0 and gate FARM only?
