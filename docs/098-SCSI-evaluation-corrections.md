---
type: task
status: todo
---

# SCSI evaluation corrections

From [085](085-Disk-fault-coverage.md), gap 5. Small.

## Problem

`evaluateScsi` (`shared/smart/evaluate.ts`) has two faults of its own:

- Errors corrected by rereads or rewrites fail at any value above 0, for read and
  write. These are routine on SAS drives and would fill the Faults page on the first
  real one.
- The verify direction is parsed (`ScsiInfo.verify`) but the evaluator loops over read
  and write only, so verify uncorrected errors raise nothing.

## Design

- Corrected by rereads/rewrites: no threshold, display only.
- Add verify to the loop: `verify_total_uncorrected_errors` fails above 0 like read and
  write; the other verify counters are display.
- Grown defects and uncorrected errors keep failing above 0.

## Work

1. `evaluateScsi` and `SCSI_METADATA` entries for the verify rows.
2. Bump `SMART_POLICY_VERSION` so stored readings re-evaluate.
3. Tests against the SCSI fixtures.

Not in scope: non-medium error count and the SAS SSD endurance indicator, which aren't
parsed yet.
