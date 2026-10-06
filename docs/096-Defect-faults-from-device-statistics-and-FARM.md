---
type: task
status: todo
---

# Defect faults from device statistics and FARM

From [085](085-Disk-fault-coverage.md). Decisions taken 2026-10-06.

## Problem

Defect faults come only from ATA attributes in the defect class
(`shared/smart/classification.ts`). WD/HGST and Toshiba drives don't report 187 or 188
([086](086-Disk-risk-level.md)), so defect coverage is fullest on Seagates. The same
facts arrive from two other sources that are displayed and never evaluated:

- ATA Device Statistics (`shared/smart/deviceStatistics.ts`): `reportedUncorrectables`
  (4:8), `reallocatedSectors` (3:32), `reallocationCandidates` (3:56), `pendingErrors`
  (1:64), `mechanicalStartFailures` (3:48).
- Seagate FARM (`SeagateFarm` in `shared/smartctl.ts`): `errors.unrecoverableReads`,
  `errors.unrecoverableWrites`, `errors.reallocatedSectors`,
  `errors.reallocationCandidates`, per-head `unrecoverableReadsRepeating` and
  `unrecoverableReadsUnique`, and `heliumPressureTripped`.

## Design

- **Fill gaps only.** A device-statistics or FARM figure is evaluated only where the
  drive has no ATA attribute for the same fact. Where attribute 5 and 3:32 both exist,
  the attribute stays the single source and no second fault appears.
- Mapping from fact to sources, in preference order:

  | Fact | Attribute | Device statistics | FARM |
  |---|---|---|---|
  | Reallocated sectors | 5 | 3:32 | `errors.reallocatedSectors` |
  | Pending sectors | 197 | 3:56, 1:64 | `errors.reallocationCandidates` |
  | Reported uncorrectable | 187 | 4:8 | `errors.unrecoverableReads` + `unrecoverableWrites` |
  | Offline uncorrectable | 198 | none | none |

- **Evaluated at detection time.** No synthetic attribute rows are written: stored
  history can't be adjusted after the fact, so rows written from now on would leave
  past readings without them. The detector reads the substitute from the reading's
  device statistics or FARM data when the attribute is absent.
- The substitute value is evaluated with the attribute's own metadata and Backblaze
  buckets, and raises the existing `smart-attribute` fault under the attribute's id, so
  acceptance and titles work unchanged. Trend comes from the substitute's own history. The fault data records the source, and
  the title names it ("Reported uncorrectable errors (device statistics)").
- Skip device-statistics fields the drive flags as normalised (`normalised[]`) and
  entries without `flags.valid`. Check [088](088-Device-statistics-data-quality.md)
  before trusting a field.
- FARM is comparable only from log major 3 (`farmHoursComparable`); apply the same gate.
- **Helium trip.** `heliumPressureTripped` raises a new kind `helium-tripped`: error,
  persistent, actions acknowledge, accept, clear. Attribute 22 keeps its vendor
  threshold; [084](084-Statistics-tab.md) adds the note below 100.
- Per-head unrecoverable counts, mechanical start failures and resistance outliers stay
  notes (084); they locate a problem but the totals above already fault on it.

## Work

1. Substitute evaluation in `detectSmartAttributes`, with the evaluation function
   shared with `evaluateAtaAttribute`. Disk status (`latestStatus`) and the attribute
   table must reach the same verdict, so both read through the same function.
   `attributeTrend` needs a variant over device statistics and FARM history; check that
   history is stored per reading.
2. `helium-tripped` kind and detector in `server/services/farmFaults.ts`.
3. Bump `SMART_POLICY_VERSION`; `faultsBackfill.ts` entries.
4. Simulator scenarios for a WD-style drive with 4:8 rising and for a helium trip.
5. Tests: no duplicate when attribute and statistic agree; normalised fields skipped.

## Questions

1. Synthetic attribute rows or detector-time substitution? Answered 2026-10-06:
   detection time.
2. If attribute and statistic both exist and disagree, is that worth a note? Not a fault
   under the fill-gaps rule.
