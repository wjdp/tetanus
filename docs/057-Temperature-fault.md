---
type: task
status: done
---

# Temperature fault

Temperature thresholds exist and colour the UI, but a hot disk never becomes a fault,
so it never alerts and never reaches the diary.

## Problem

A disk running hot is a standard thing to expect a disk monitor to tell you about, and
it is often the first sign of a failed fan or a blocked bay. tetanus has per-host
thresholds (`Host.temperatureThresholds`, hdd/ssd warning and error, defaults in
`shared/temperature.ts`) and uses them to colour the temperature in disk lists and
pages (`temperatureColour`). Nothing turns the colour into a fault. The Faults page,
sidebar counts, alerts and acceptance all hang off `Fault` rows, so a disk at 60 °C is
"healthy" everywhere but one cell.

## Context

- `TemperatureReading` has every sample (hourly, plus SCT history backfill from
  `sctTemperaturePoints`); `Disk.latestTemp` is the current value.
- SMART evaluation (`shared/smart/evaluate.ts`) lists `temperature` with
  `NO_THRESHOLD`, so attribute status is always `passed`. The same gap exists for SSD
  wear in [052](052-SSD-wear-monitoring.md), which proposes folding its rule into
  evaluation; temperature is the other candidate for whatever shape that takes.
- Hosts differ: a NAS in a cupboard runs hotter than one on a desk, which is why the
  thresholds are per host. Spikes during a scrub are normal; a sustained high reading
  is not.
- The demo fleet and the fault simulator ([044](044-Fault-simulator.md)) would need a
  scenario.

## Design

Designed alongside [055 Pool capacity fault](055-Pool-capacity-fault.md); both use the
same threshold helper and the same alerting change. Build this one first.

- **Kind** `temperature-high`: category `disk`, subject `disk`, lifetime `transient`,
  actions acknowledge / accept / clear. Not in `DIARY_SILENT_KINDS`. Title like
  `58 °C (limit 55 °C), hot for 2 h`, falling back to `Running hot` when `data` is empty (fault
  backfill replays with `{}`).
- **Subject**: one fault per disk, no host roll-up. Same disk filter as
  `detectSmartAttributes` (`inService()`); disks with no host use `TEMPERATURE_DEFAULTS`.
  Use the resolved thresholds already on `DiskSummary`.
- **Sustained, by duration**: measured back from the disk's newest reading, not the
  clock. Open when the unbroken run of readings at or above warning that ends with the
  newest spans at least `sustainedMinutes`. A gap longer than `max(sustainedMinutes,
  90 min)` breaks the run (hourly readings arrive late). Without SCT history this is two
  consecutive hourly readings. SCT points count too; their timestamps are approximate,
  and one cool point breaks the run, which is acceptable. `hotSince` is the run's start.
- **Setting**: `sustainedMinutes` (default 60, in `shared/temperature.ts`) joins hdd/ssd in
  `Host.temperatureThresholds`. Widen `temperatureThresholdsSchema` and rework
  `SettingsForm.vue` so it keeps the field instead of rebuilding the object from hdd/ssd.
- **Severity** follows the latest reading: at or above warning → `warning`, at or above
  error → `error`, moving up within the same fault.
- **Hysteresis, both edges**: once open, it steps down from error only below
  error − 3 °C and clears only below warning − 3 °C. Fixed margin, no setting. Opening
  still needs the sustained window; staying open needs only the latest reading.
- **Live row**: `applyDetections` resolves anything not re-detected, so the detector needs
  the live fault to apply the margin. `liveFaultsByKey(kind)` in
  `server/services/liveFaults.ts`; 055 uses the same.
- **Host silence**: nothing special. Because the fault is judged against the disk's own
  newest reading, a silent host holds its disks' faults as they were; no ageing out, no
  re-alert on return. Missing, dead, retired and disposed disks are skipped, so their
  faults resolve.
- **Accept**: the generic `accepted` state, muted until severity rises. If an accepted
  fault cools and resolves, the next hot spell opens a new fault and alerts again; that's
  intended, and the fix is to raise the host's thresholds.
- **Alerts**: add `temperature-high` to `ALERT_RULES` and the fault-kind/alert-rule map in
  `shared/faults.test.ts`. Disk entries never reach `FAULT_OPENED_RULES` today (only
  `matchPoolEntry` checks it), so lift the `fault-opened` match out so it applies to every
  subject type.
- **Alert on rise to error**: `refreshFault` writes a `fault-severity-raised` diary event
  whenever severity rises, for every non-silent kind; fault backfill replays it. Alerts
  fire on it only for kinds in `RAISED_ALERT_RULES`. Fault alert matching
  (`fault-opened`, `fault-severity-raised`) checks the entry's subject type against the
  kind's. Shared with 055.
- **Not in evaluation**: thresholds are per host, not per attribute, so this lives in fault
  detection, not `shared/smart/evaluate.ts`.
- **Cost**: detection runs every 5 min and after each ingest. A live fault is judged on
  `Disk.latestTemp` alone; `TemperatureReading` is queried only for a disk with no live
  fault whose `latestTemp` is at or above warning.
- **Subject link**: `faultSubjectPath` sends this kind to the disk page's SMART tab.
- **Simulator**: `temperature-hot` / `temperature-critical` take a "hot for" minutes
  param (default the host's window) and rewrite that window of `TemperatureReading` at
  the chosen temperature, so the fault opens.
- **Demo fleet**: atlas's warmest disk peaked at 45 °C during scrubs; atlas ambient
  lowered to 21 °C. No disk is deliberately warm; the simulator covers that.

### Shared helper

`thresholdSeverity(current: FaultSeverity | null, value, { warning, error }, margin)` in
`shared/faults.ts`: `value ≥ error → error`; `current = error and value ≥ error − margin →
error`; `value ≥ warning → warning`; `current and value ≥ warning − margin → warning`;
otherwise null. The sustained window stays outside it.

## Prior art (added 2026-10-04)

From a review of Starosdev's scrutiny fork:

- Its temperature alert is sustained by default: above 55 °C for 30 minutes. Its users
  have accepted this shape and it isn't a source of complaints, which suggests answering
  question 1 with "sustained".
- Its threshold is one global value, not per media type or per host. tetanus's per-host
  hdd/ssd thresholds are already finer.
- Temperature quirks are a frequent scrutiny complaint (negative readings, wrong source
  attribute, per-drive temperature source requests in Starosdev #917). tetanus reads
  smartctl's `temperature.current` rather than an attribute, which avoids most of these.
- A hot disk is often the first visible sign of a failed fan, so this may deserve to land
  ahead of [016](016-Snapshot-staleness.md) and [018](018-Capacity-forecast.md).

