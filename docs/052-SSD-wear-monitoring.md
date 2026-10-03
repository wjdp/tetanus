---
type: task
status: planned
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
