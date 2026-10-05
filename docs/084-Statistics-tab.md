---
type: task
status: planned
---

# Statistics tab

Follows [083](083-Seagate-FARM-log.md), whose FARM workload and environment panes only
Seagates get.

## Problem

The SMART tab shows workload, error and environment figures only for Seagates, through
FARM. Other drives report most of the same figures in a standard log that tetanus
already receives and doesn't read.

## Context

- The ATA Device Statistics log (GP log 0x04, ACS) comes in with every `--xall` reading
  as `ata_device_statistics.pages[]`. Each page has `number` and `name`, and a `table[]`
  of entries with `offset`, `name`, `value` and `flags.valid`. Every ATA fixture on mars
  has it (WD, Seagate, Toshiba, Intel and Samsung SSDs) except a Samsung 850 EVO.
- Pages seen in the fleet:
  - 1 General: power-on resets, power-on hours, logical sectors read and written, read
    and write commands, pending errors (Toshiba)
  - 2 Free-Fall (Toshiba): over-limit shock events
  - 3 Rotating Media: spindle and head-flight hours, head load events, reallocated and
    reallocation-candidate sectors, read recovery attempts, mechanical start failures,
    high-priority unloads
  - 4 General Errors: reported uncorrectables, resets between command acceptance and
    completion
  - 5 Temperature: current; short- and long-term averages with their highest and
    lowest; lifetime highest and lowest; time over and under limit; rated maximum and
    minimum
  - 6 Transport: hardware resets, ASR events, interface CRC errors
  - 7 Solid State: percentage used (empty on the Toshiba)
  - 255 Vendor Specific: undecoded
- Nothing parses it today. Only the demo renderer (`server/demo/smartctlJson.ts`) and
  the simulator (`server/services/simulator/smartctl.ts`) rewrite it.
- Entry names vary slightly between firmwares. Page number plus offset is what the
  standard fixes, so use that as the identity.
- NVMe has a rough equivalent in `nvme_smart_health_information_log`: data units
  read/written, host reads/writes, controller busy time, warning and critical
  temperature time, unsafe shutdowns. tetanus reads some of it into counters
  (`shared/smart/counters.ts`).
- SAS has error counter and temperature log pages, partly parsed into `ScsiInfo`.
- FARM adds things the standard log lacks: random vs sequential split, voltages,
  per-head values, and hours that survive a SMART reset.

## Caveats of the ATA log

- Wiped along with SMART on a reset: a grey-market drive in the fleet reports the same
  reset power-on hours in device statistics as in attribute 9. FARM remains the only
  reset check.
- Entries can be flagged not valid. Keep only `flags.valid` entries, but don't rely on
  that alone: Seagates flag "Date and Time TimeStamp" (1:56) invalid while Toshiba
  reports it valid.
- Some entries roll or reset by design and are left out explicitly: 1:56 time since
  power-on, the short-term temperature averages and current temperature (page 5). Also
  4:24 "Physical Element Status Changed", which is a notification flag, not an error.
- Entries can be flagged normalised: WD and Toshiba temperature averages and Samsung
  percentage used. Record the flag, show the values, and don't threshold them.
- Reset counters are not errors. Hardware resets, ASR events and "resets between
  command acceptance and completion" count every boot and link reset (hundreds on
  healthy drives in the fleet). They're plain figures, not error styling. Of the
  transport page, only interface CRC (6:24) is a concern.
- Interface CRC (6:24) is the same counter as attribute 199, which already has
  history. Show the statistic as a figure only.
- Not every drive has the log (a Samsung 850 EVO doesn't; older drives and some USB
  bridges may not). Absent means the panes don't show.
- Units: data in logical sectors (multiply by the drive's logical sector size),
  over/under-temperature time in minutes. Counters saturate rather than wrap.
- No extra cost: it already comes with `--xall`, and drives in standby are skipped as
  now.

## Plan

### Data

- Decode at ingest into typed fields, as FARM is: a shared `DEVICE_STATISTIC_FIELDS`
  maps `page:offset` (the identity ACS fixes) to a field name (`"1:8"` →
  `powerOnResets`, …). The result is `DeviceStatistics { powerOnResets?, sectorsRead?,
  …, normalised: string[] }` on `SmartctlXallResult`, in `shared/smartctl.ts`.
- Store `Disk.latestDeviceStatistics` json, written in `recordSmartReading`'s
  `isLatest` branch. Keep it off `DiskSummary` and `/api/disks`, since no detector needs
  it, unlike `latestFarm`.
- A new `/api/disks/:id/statistics` endpoint. It isn't added to the SMART overview,
  which is refetched on every history-range change.
- NVMe needs no new parse or store. Its health log is already kept per reading as
  attributes, with history. The endpoint builds NVMe panes from `latestAttributes()`
  (data units read/written, host reads/writes, controller busy time, warning and
  critical temperature time, unsafe shutdowns). There are no lifetime temperature
  extremes, so the Environment pane is thinner.

### A Statistics tab

The SMART tab keeps the health signals: status, temperature chart, attributes,
self-tests, and the error log (074). A new Statistics tab holds lifetime and operational
detail:

- Workload: commands, data read and written, power-on resets, random share (FARM)
- Errors: uncorrectables, reallocated and candidates, read recovery, start failures,
  shock events (Toshiba)
- Transport: hardware resets, ASR events, command resets, CRC as plain figures
- Environment: lifetime lowest to highest, averages, time over and under limit, rated
  range, voltages (FARM). The temperature chart and the temperature fault stay on SMART.
- Seagate FARM: drive facts and the per-head table. It moves here from the SMART tab.
  Where FARM and device statistics both report a figure, show it once.

In the Errors pane, flagged items come first and zero counters collapse into one quiet
line ("No uncorrectables, reallocations or start failures").

This reverses 083's decision to keep FARM on the SMART tab. The reset verdict stays
visible beside SMART through the fault and the power-on headline figure, which already
shows FARM hours. `SMART_FAULT_KINDS` must send `smart-counters-reset` to
`?tab=statistics`.

### Notes

A tab should never be the only place a concern shows. Anything worth an alert is a fault
(fault kinds belong to [085](085-Disk-fault-coverage.md); this task adds none). Lesser
concerns are notes.

- There's already a soft tier, ad hoc: wear colouring with no fault (052), FARM head
  highlights (`farmRows.ts`), the spec-mismatch footer and link-speed colouring on
  Overview. Notes formalise it.
- `shared/notes.ts`: `DiskNote { id, text, tab, anchor }`. Computed in
  `server/services/diskNotes.ts` from the disk row and latest attributes, and returned on
  `DiskDetail` so Overview, the tab badge and the tab share one list, as `faultCounts`
  does.
- Shown in a "Worth a look" list in the Overview Health group, as a neutral count badge
  on the Statistics tab (like Diary's), and at the top of that tab, each linking to its
  pane or row.
- Never on the home page, lists, navigation or alerts.
- No dismiss, so keep the set small and phrase lifetime counters as facts. First set:
  - interface CRC errors, from attribute 199, while rising
  - time over the rated temperature above 0
  - a head with outlying resistance, or reallocations on one head
  - NVMe unsafe shutdowns rising, from attribute history
- Fold the existing ad hoc highlights in where they fit.

### Demo and simulator

- The demo rewrites statistics by name (`server/demo/smartctlJson.ts`) and leaves CRC,
  shock, ASR and over-temperature time at the captured values, so demo disks would show
  notes from fixture numbers. Zero those, or drive them from stories.
- The simulator edits raw JSON by name; it stays as it is.

### Commits

1. Shared type and ingest decode, with fixture tests: WD, Seagate, Toshiba, SSDs, and
   the 850 EVO without the log.
2. `Disk.latestDeviceStatistics`, written at ingest; statistics service and endpoint
   (ATA from the column, NVMe from latest attributes).
3. Demo statistics values.
4. Statistics tab and panes; move `DiskFarm`; fix the fault link; migrate tests; one
   statistics e2e.
5. Notes: shared type, server service, `DiskDetail.notes`, Overview list, tab badge.

## Out of scope

- New fault kinds ([085](085-Disk-fault-coverage.md)).
- History of these values. Only the latest is kept, as for FARM.
- Vendor-specific page 255.
- SAS log pages, until there's a real SAS fixture.

## Proof of concept

Built on branch `084-statistics-tab` (2026-10-05). Differences from the plan:

- FARM has its own tab, shown only for drives with a FARM log, rather than a section on
  Statistics. The counters-reset fault links to it.
- A Faults tab lists the disk's live faults with their actions, plus the ten most
  recently resolved. The fault badges open it instead of the Faults page, so a disk's
  faults can be seen and dealt with on the disk itself.
- NVMe error-log entries are a plain figure, not an error.
- Not built yet: notes ("Worth a look"), de-duplicating figures FARM and device
  statistics share, and a statistics e2e test.

