---
type: task
status: todo
---

# SCT temperature history dated across power-off

SCT temperature history backfill dates samples as if the drive had been powered on continuously, so a drive that was switched off, shelved or moved between hosts gets temperatures charted on days it was unplugged.

## Problem

`sctTemperaturePoints` (`server/services/smart.ts`) places sample `i` at `receivedAt − (newest − i) × interval`, counting back in wall-clock time. The drive only logs SCT samples while it is powered on, so the buffer is a sequence in power-on time, and any time off is collapsed out of it. Samples from the last session the drive ran are spread back over the days it was off.

Seen on a disk read on one host, then read again five days later with only six more power-on hours. The 30 d temperature chart shows a steady ~43 °C plateau across the days it sat on a shelf, then the cold-start drop when it was plugged back in.

Every disk that has been powered off, rebooted for a while, or moved between hosts is affected. Points are deduplicated on `(diskId, at)`, so the wrong points stay and later true readings for the same minute are dropped. The temperature fault ([057](057-Temperature-fault.md)) counts SCT points, so the bogus ones can open or extend a fault.

## Plan

1. **Bound the backfill by power-on time.** Look up the disk's previous reading. Compare wall time since that reading (Δwall) with the increase in power-on hours (ΔPOH).
   - Δwall ≈ ΔPOH (within an hour or so): powered on throughout, so keep samples back to the previous reading.
   - Otherwise keep only samples within ΔPOH of `receivedAt`, because only those are known to fall after the last power-on. If the power-cycle count rose, cap that at the time since the most recent power-on; with no previous reading, cap at current POH or the buffer length, whichever is less.
   - Never date a sample earlier than the previous reading; that span was already covered by the samples taken then.
2. **Mark the source.** Add `TemperatureReading.source` (`reading` | `sct` | `scrutiny`) so SCT-derived points can be told apart, charted differently if wanted, and cleaned up.
3. **Clean existing data.** A migration or one-off task replays the rule over stored readings. For each pair of consecutive readings of a disk where ΔPOH is well short of Δwall, delete points dated strictly between them that are not one of the readings' own `temp` values. Existing rows predate the `source` column, so this has to be inferred from timing.
4. **Tests.** Unit tests for `sctTemperaturePoints` covering continuous power, a power-off gap, a power cycle and a first-ever reading; a regression test with a captured fixture pair that has a shelf gap.

## Questions

1. What tolerance should "Δwall ≈ ΔPOH" use? Readings are hourly, and POH is whole hours.
2. Should SCT points be drawn differently on the chart (e.g. thinner, or dotted) once they are marked?
