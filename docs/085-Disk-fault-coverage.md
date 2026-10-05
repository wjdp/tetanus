---
type: review
status: open
---

# Disk fault coverage

What should raise a fault, across everything tetanus collects about a disk. Started
2026-10-06 after heavy SSD wear raised nothing. Companion to
[084](084-Statistics-tab.md), which adds the "note" tier (shown on Overview and the
Statistics tab, no alert) used below.

## Why SSD wear didn't fault

- **ATA SSDs.** `shared/smart/evaluate.ts` only raises a status for defect-class
  attributes (`shared/smart/classification.ts`: 5, 10, 184, 187, 188, 196, 197, 198,
  201). Wear attributes (177, 231, 233, 202, 245) are context, with no thresholds in
  `metadata.json`, so they only fail if the vendor's own `when_failed` fires, which
  Samsung's threshold of 0 never does. The 80/100 % colouring lives only in the list
  column (`shared/smart/counters.ts`) and never reaches `detectSmartAttributes`.
- **NVMe.** `percentage_used` is checked against a fixed 100 with a strict `>`, so 87 %
  and even exactly 100 % pass, and there's no warning tier. `available_spare` only fails
  below the drive's own threshold (usually 10 %).
- [052](052-SSD-wear-monitoring.md) and [019](019-SSD-endurance.md) already plan this;
  [036](036-Faults-page.md) lists `ssd-endurance-low` as a future kind.

## Classification

Fault = alert and lifecycle. Note = shown, no alert (084). Display = shown only.

| Signal | Source | Today | Proposed |
|---|---|---|---|
| SSD wear | NVMe `percentage_used`; ATA wear attributes | NVMe error only over 100; ATA never | **Fault** `ssd-endurance-low`, persistent: warning ≥ 80 %, error ≥ 95 %. One rule over the `counters.ts` wear figure for both protocols |
| NVMe available spare | NVMe log | error below the drive's threshold | Keep, plus warning at threshold + 10 |
| NVMe critical warning | NVMe log | error if non-zero | Keep; decode the bits in the title (spare, temperature, reliability, read-only, backup) |
| NVMe media errors | NVMe log | error if > 0 | Keep |
| Self-test failed | `SelfTest` rows, exit bit 7 | **nothing** | **Fault** `self-test-failed`, persistent, key `diskId:lifetimeHours`: error on a read failure |
| Helium tripped (FARM) | FARM | parsed, no detector | **Fault**, error |
| Helium level (22) | ATA attribute | vendor `when_failed` only | Note when normalised < 100; fault stays at threshold |
| Reallocated, pending, uncorrectable, 187, 184, spin retry, timeouts | ATA defect class | fault by rate and `when_failed` | Keep |
| Interface CRC | attribute 199 (with history; device stats 6:24 and FARM repeat it) | display | Note while rising; warning fault if rising across 3 or more readings |
| ATA error log entries | exit bit 6 | parsed, unused | Note when the count rises; [074](074-SMART-error-log.md) decides more |
| NVMe error log entries | NVMe log | display | Note when rising |
| NVMe unsafe shutdowns | NVMe log | display | Note when rising (PSU or host hygiene, not drive health) |
| Hardware resets, ASR events, command resets | device stats, FARM | display | Display: they count every boot and link reset |
| Time over temperature limit | device stats, NVMe warning/critical time | display | Note > 0; live temperature is already a fault (057) |
| FARM per-head reallocations, resistance outliers, start failures, ASR | FARM | display | Note |
| SCSI grown defects, uncorrected errors | SCSI info | error > 0 | Keep |
| SCSI errors corrected by rereads/rewrites | SCSI info | **error > 0** | **Display**: routine on SAS drives, would flood the Faults page |
| Warranty ending | inventory | display | Fault `warranty-ending`, transient, warning within 6 weeks ([020](020-Warranty-nudge.md)) |
| Self-test or scrub overdue | readings | nothing | [017](017-Scrub-and-self-test-overdue.md) |
| Rated hours, load cycles, start-stops | attributes, FARM | display | Display; few drives publish ratings |
| SMART reset (FARM) | FARM | warning fault | Keep ([083](083-Seagate-FARM-log.md)) |
| SMART health failed | `smart_status` | error fault | Keep |
| Standby, missing reading | readings | skipped | Display; `disk-missing` and `collector-silent` cover absence |

## Gaps, by user impact

1. SSD wear never faults. Implement 052/019 as above, and bump `SMART_POLICY_VERSION` so
   `reapplySmartPolicy` re-evaluates stored readings.
2. Self-test failures raise nothing, even a failed long test.
3. FARM helium trip has no detector.
4. Error-log growth and interface CRC errors are invisible outside the SMART tab. Notes
   first, then the rising-CRC warning.
5. SCSI corrected-by-reread errors fail at > 0. This is noise waiting for the first real
   SAS drive.

Minor: thresholds compare with a strict `>`, so a value exactly at the threshold
passes. NVMe `num_err_log_entries` is marked critical in metadata but never evaluated.

## Next

Turn gaps 1–3 and 5 into tasks, or fold them into 052, 019 and 074 where they already
fit. Gap 4 depends on 084's notes.
