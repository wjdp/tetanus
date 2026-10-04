---
type: task
status: planned
---

# Temperature fault

Stub. Temperature thresholds exist and colour the UI, but a hot disk never becomes a
fault, so it never alerts and never reaches the diary.

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

## Questions

1. Instantaneous or sustained: does one hot sample open a fault, or N samples over M hours?
2. Is a hot disk a disk fault or a host fault (one fan failing heats every disk)?
3. Should the threshold "error" level map to `failed` severity, or is temperature only ever a warning?
