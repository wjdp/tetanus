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
| SSD wear | NVMe `percentage_used`; ATA device statistics 7:8, else wear attributes | NVMe error only over 100; ATA never | **Fault** `smart-attribute`: warning ≥ 80 %, error ≥ 100 % ([052](052-SSD-wear-monitoring.md)) |
| NVMe available spare | NVMe log | error below the drive's threshold | Keep, plus warning at threshold + 10 (052) |
| ATA SSD reserved space | attributes 170, 179, 180, 232 by name | vendor `when_failed` only | Same two tiers as NVMe spare (052) |
| SSD program/erase fail counts, runtime bad blocks | attributes 171, 172, 181–183 by name | vendor `when_failed` only | **Fault**, warning when non-zero and risen ([097](097-SSD-defect-attributes.md)) |
| NVMe critical warning | NVMe log | error if non-zero | Keep; decode the bits in the title (052) |
| NVMe media errors | NVMe log | error if > 0 | Keep |
| Self-test failed | `SelfTest` rows, exit bit 7 | **nothing** | **Fault** `self-test-failed`, error, persistent; resolved by a later pass of the same or a longer type ([095](095-Self-test-failed-fault.md)) |
| Helium tripped (FARM) | FARM | parsed, no detector | **Fault** `helium-tripped`, error ([096](096-Defect-faults-from-device-statistics-and-FARM.md)) |
| Helium level (22) | ATA attribute | vendor `when_failed` only | Note when normalised < 100; fault stays at threshold |
| Reallocated, pending, uncorrectable, 187, 184, spin retry, timeouts | ATA defect class | fault by rate and `when_failed` | Keep |
| The same defect counts from device statistics (3:32, 3:56, 1:64, 4:8) and FARM (reallocated, candidates, unrecoverable reads and writes) | device stats, FARM | display | **Fault** `smart-attribute`, only where the drive lacks the attribute (096) |
| Interface CRC | attribute 199 (with history; device stats 6:24 and FARM repeat it) | display | Note while rising; warning fault if rising across 3 or more readings ([101](101-Disk-notes-for-cabling-and-power.md)) |
| NVMe error log entries | NVMe log | display | Display: the count is mostly host protocol errors (100) |
| ATA error log entries | error log count; exit bit 6 | parsed, unused | **Fault** `error-log-growth`, warning, until resolved by the user ([100](100-Error-log-growth-fault.md)); folds into a live defect fault as an escalation; [074](074-SMART-error-log.md) shows the entries |
| NVMe unsafe shutdowns | NVMe log | display | Note when rising (PSU or host hygiene, not drive health) (101) |
| Hardware resets, ASR events, command resets | device stats, FARM | display | Display: they count every boot and link reset |
| Time over temperature limit | device stats, NVMe warning/critical time | display | Note > 0 (101); live temperature is already a fault (057) |
| FARM per-head reallocations, resistance outliers, start failures, ASR | FARM | display | Note |
| Link speed below the drive's maximum | identity | parsed, unused | Display, highlighted on the disk page (101). Can't tell a cable from an old controller |
| FARM 12 V and 5 V rails | FARM | display | Display for now: lifetime extremes, so one old brown-out would show for ever |
| SCSI grown defects, uncorrected errors | SCSI info | error > 0; verify direction not evaluated | Keep, and add verify ([098](098-SCSI-evaluation-corrections.md)) |
| SCSI errors corrected by rereads/rewrites | SCSI info | **error > 0** | **Display**: routine on SAS drives, would flood the Faults page (098) |
| Warranty ending | inventory | display | Fault `warranty-ending`, transient, warning within 6 weeks ([020](020-Warranty-nudge.md)) |
| Self-test or scrub overdue | readings | nothing | [017](017-Scrub-and-self-test-overdue.md) |
| Rated hours, load cycles, start-stops | attributes, FARM | display | Display; few drives publish ratings |
| SMART reset (FARM) | FARM | warning fault | Keep ([083](083-Seagate-FARM-log.md)) |
| SMART health failed | `smart_status` | error fault | Keep |
| Standby, missing reading | readings | skipped | Display; `disk-missing` and `collector-silent` cover absence |
| SMART unsupported, disabled or unreadable | `smartSupport`, `commandFailed` | parsed, unused | **Fault** `smart-unavailable`, warning ([099](099-No-usable-SMART-data-fault.md)) |
| ZFS device errors, slow I/O and degraded devices | `leaf-errors`, `leaf-slow`, `pool-degraded` ([046](046-ZFS-fault-coverage.md)) | pool faults, not shown on the disk | Stay pool-subject; shown on the disk and read by 086 ([102](102-ZFS-signals-on-the-disk.md)) |
| SMR drive in a vdev | `recordingTech`, topology | nothing | Note (102) |

## Gaps, by user impact

1. SSD wear never faults. Implement 052/019 as above, and bump `SMART_POLICY_VERSION` so
   `reapplySmartPolicy` re-evaluates stored readings.
2. Self-test failures raise nothing, even a failed long test.
3. FARM helium trip has no detector.
4. Error-log growth and interface CRC errors are invisible outside the SMART tab. Notes
   first, then the rising-CRC warning.
5. SCSI corrected-by-reread errors fail at > 0. This is noise waiting for the first real
   SAS drive.

Minor: `percentage_used` compares with a strict `>` against 100, so exactly 100 passes
(052). The other fixed-threshold rows are right to be strict. NVMe `num_err_log_entries`
is marked critical in metadata but never evaluated, and stays that way (100).

## Second pass (2026-10-06)

Checked against the code and against smartd's defaults (`-a` alerts on self-test
failures, error-log growth and non-zero 197/198). Rows added above: ATA SSD spare and
defect attributes, defect counts from device statistics and FARM, link speed, FARM
rails (both display only), unusable SMART, ZFS device errors and SMR. Changes of mind: wear errors at 100 %
not 95 %, through `smart-attribute` not a new kind; error-log growth is a fault, not a
note.

Rejected: detecting a SMART reset on non-Seagates from counters falling between
readings. `smart-counters-reset` stays FARM-only.

Every new kind needs a simulator scenario ([044](044-Fault-simulator.md)) and, where
history exists, a `faultsBackfill` entry, not only a policy version bump.

## Tasks

| Task | Covers |
|---|---|
| [052](052-SSD-wear-monitoring.md) | gap 1: wear, NVMe and ATA spare |
| [095](095-Self-test-failed-fault.md) | gap 2 |
| [096](096-Defect-faults-from-device-statistics-and-FARM.md) | gap 3, defect counts outside the attribute table |
| [097](097-SSD-defect-attributes.md) | SSD fail and bad-block counts |
| [098](098-SCSI-evaluation-corrections.md) | gap 5, SCSI verify |
| [099](099-No-usable-SMART-data-fault.md) | disks reporting without SMART data |
| [100](100-Error-log-growth-fault.md) | gap 4, error log |
| [101](101-Disk-notes-for-cabling-and-power.md) | gap 4, CRC and the other notes; defines "risen"; needs 084 |
| [102](102-ZFS-signals-on-the-disk.md) | ZFS device faults on the disk, SMR; feeds 086 |
