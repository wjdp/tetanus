---
type: task
status: todo
---

# Device statistics data quality

Follows [084](084-Statistics-tab.md).

## Problem

The Statistics tab shows the ATA Device Statistics log as the drive reports it. A survey
of the dev fleet (2026-10-05, 19 ATA disks with the log) found the decode correct but
several figures from the drives themselves wrong or not comparable. The tab presents
them as fact: K6 reads "9.10 PB read", which would be about 76 MB/s non-stop for its
whole life.

## Context

- Statistics live on `Disk.latestDeviceStatistics`, decoded by
  `server/ingest/deviceStatistics.ts`; rows are built in
  `app/components/disk/statisticsRows.ts`; FARM in `app/components/disk/farmRows.ts`.
- FARM and device statistics share figures that 084 left un-deduplicated.

## Findings

Implausible or inconsistent figures:

1. **Seagate sectors read.** Device statistics (1:40) and attribute 242 agree with each
   other but run well above FARM's sectors read on some drives: K6 about 4×, L2 about
   3×, L4 about 2×. Q3 and Q4 match. Read commands and sectors written agree with FARM
   on all of them, so only sectors read is off. FARM's figure is the plausible one
   (sectors per read command in line with the other drives).
2. **Q1: device statistics behind FARM.** Sectors written and read commands in device
   statistics are lower than FARM, so the log looks to have been reset at some point
   (firmware update or a vendor tool). Lifetime workload undercounts there.
3. **M1 (Samsung SM863a) workload units.** Sectors written ÷ write commands is far above
   the 65,536-sector maximum transfer per command, and the implied total written
   contradicts its low percentage used. Attributes 241/242 carry the same values, so
   the units are vendor-specific and unknown. Read commands also look too low for its
   power-on time.
4. **L1 (Toshiba MG09) spindle and head flight hours.** A few hundred hours against
   tens of thousands powered on. Different units or meaningless; currently shown as
   years.
5. **M3 (Intel S3510) resets.** Hardware resets and ASR events in the thousands, against
   tens to hundreds on every other drive. Possibly a different meaning; unconfirmed.

Coverage gaps (drive behaviour, not bugs):

- M2 and M3 (Intel) omit power-on hours (1:16); attribute 9 covers it.
- Field count ranges from 15 (Samsung SSDs) to 30 (Toshiba). Only L1 reports pending
  errors (1:64) and shock events (2:16).
- The in-use 860 EVO M.2 and Z1 (850 EVO) have no device statistics. Not yet confirmed
  whether the drives lack the log or haven't been read since 084.

Real signals worth surfacing (the "Worth a look" notes 084 didn't build):

- H4 runs hot: long-term average in the mid 50s °C, peak a couple of degrees under its
  65 °C rating.
- L1 has read recoveries in the thousands (next highest drive: tens) and a handful of
  shock events.
- Q1 has one reported uncorrectable.
- M1's peak temperature is within a degree of its 55 °C rating.

## Plan

- Prefer FARM for workload figures on drives that have it; drop or footnote the
  device-statistics duplicate (this also does 084's de-duplication).
- Plausibility checks in `statisticsRows.ts`, hiding or flagging a figure that fails:
  - sectors per command above 65,536 (read or write) → workload volume untrusted
  - spindle or head flight hours far below power-on hours → hide
  - device statistics workload below FARM → note the log was reset
- Keep reset and ASR counters as plain figures (084); no absolute thresholds, vendors
  vary too much.
- Confirm the 860 EVO M.2 and Z1 case from a fresh `--xall` payload.
- Notes for temperature near rating and outlier read recoveries, if 085's fault
  coverage doesn't already cover them.
- Fixtures for K6 (sectors read mismatch), M1 and L1, with placeholder serials.

## Unanswered questions

- Seagate 1:40 vs FARM: is there a known explanation (e.g. internal or background
  reads counted in 1:40), and should attribute 242's history be distrusted too?
- M1: find Samsung's unit for 241/242 on SM863a, or just mark workload unknown?
- M3: are Intel's reset counts real link instability worth checking cabling for?
