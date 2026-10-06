---
type: task
status: done
---

# SSD wear monitoring

Stub. Decisions deferred.

## Problem

[050](050-Disk-list-columns-and-views.md)'s Wear column colours ATA SSD wear
`warning` ≥ 80 %, `failed` ≥ 100 %, but only in the column
(`shared/smart/counters.ts`). SMART evaluation does not classify ATA wear
attributes: metadata has no threshold or ideal for 177 / 231 / 233, so their
stored status stays `passed`. No fault is raised, so:

- the disk page, Faults page, sidebar counts and alerts call the disk healthy
  while the list shows amber;
- the user cannot acknowledge or accept it (acceptance hangs off a fault).

NVMe `percentage_used` is evaluated (`failed` at 100), so it already raises a
fault and acceptance works, but has no 80 % warning outside the column.

## Direction (proposed)

Move the wear rule into SMART evaluation. For SSDs with a wear attribute matched
by name (`Disk.ataSsdAttributes.wear`, `shared/smart/ataSsdAttributes.ts`),
evaluation marks it `warning` / `failed` by threshold; faults, disk status,
alerts and acceptance follow for free. The column then reads attribute status
only, like NVMe.

## Open decisions

- Thresholds: 80 / 100, or configurable (settings)? Same for NVMe?
- Should 80 % wear turn the disk amber and alert, or be a softer
  "plan replacement" signal (info, no alert)?
- Evaluation currently runs on stored attribute rows, whose ATA names are
  metadata display names; wear identity comes from `ataSsdAttributes`. How
  evaluation gets it (pass disk context in, or evaluate at ingest only).
- `reapplySmartPolicy` (`server/services/smartPolicy.ts`): bump the policy
  version so existing readings re-evaluate.
- Faults backfill for disks already past the threshold.
- Spare capacity (NVMe `available_spare`, ATA reserved blocks) in scope?
- Wear rate / projected end of life from history: here or separate?

## Decided (2026-10-06)

From the [085](085-Disk-fault-coverage.md) review.

- **Thresholds:** warning at 80 %, error at 100 %, for ATA and NVMe alike, matching
  `WEAR_WARNING_PERCENT` and `WEAR_FAILED_PERCENT`. Fixed, not a setting. 80 % turns the
  disk amber and alerts.
- **NVMe comparison:** `percentage_used` is compared with a strict `>` against 100, so
  exactly 100 passes. Use `>=`. The other fixed-threshold rows are correct as they are.
- **Wear source for ATA**, in order: device statistics 7:8 `percentageUsed` (the ACS
  standard figure), then the name-matched attribute in `ataSsdAttributes.wear`.
- **Spare is in scope.** NVMe `available_spare` keeps error below the drive's
  threshold and gains a warning at threshold + 10. ATA reserved-space attributes (170,
  179, 180, 232, matched by name) get the same two tiers against the vendor threshold.
  Fail and bad-block counts are [097](097-SSD-defect-attributes.md).
- **Acceptance:** wear only rises, so an accepted warning reopens on reaching error,
  and through the usual value rule otherwise.
- **Fault kind:** `smart-attribute`, as the Direction above says, so no new
  `ssd-endurance-low` kind. NVMe critical warning also decodes its bits in the title
  (spare, temperature, reliability, read-only, backup).
- Still open: how evaluation gets disk context (shared with 097), and wear rate, which
  stays in [019](019-SSD-endurance.md).
