---
type: task
status: done
---

# SSD defect attributes

From [085](085-Disk-fault-coverage.md). Decisions taken 2026-10-06.

## Problem

ATA SSDs report failures in attributes the defect class doesn't include: program and
erase fail counts (171, 172, 181, 182), runtime bad blocks (183), used and available
reserved blocks (170, 179, 180, 232). They are context class, so they fail only if the
vendor's own threshold fires. An SSD with growing erase failures raises nothing. This is
the same hole as wear ([052](052-SSD-wear-monitoring.md)), for defects.

## Design

- Match by attribute name, not id, as `shared/smart/ataSsdAttributes.ts` does for wear:
  vendors reuse ids. Add a `defects` list to `AtaSsdAttributes` holding the matched ids.
- Rule: **warning when the raw value is non-zero and has risen** within the window.
  Small static counts are common from the factory and stay passed. The vendor threshold
  (`when_failed`) still gives error.
- Reserved-space attributes are the ATA counterpart of NVMe `available_spare` and are
  handled in 052, not here. This task covers fail counts and bad-block counts.
- Raises `smart-attribute`, so acceptance works: accepting records the value, a further
  rise reopens it.
- "Risen" uses the shared definition in
  [101](101-Disk-notes-for-cabling-and-power.md).

## Work

1. Name list from the fixtures and smartmontools' drivedb; record which fleet SSDs
   expose which.
2. Evaluation needs disk context (the matched ids) and history (the rise). Same
   question as 052: pass context into evaluation or evaluate at ingest only. Solve it
   once for both.
3. Bump `SMART_POLICY_VERSION`; simulator scenario; tests.

## Questions

1. Raw-value packing: some vendors pack several counters into one raw value. Which
   attributes need a transform first?
