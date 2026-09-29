---
type: task
status: done
---

# Attribute table: importance, visibility and row history

Follow-on from [027](027-SMART-status-classification.md). With context attributes no
longer raising status, the disk page must still tell the user what matters. Today the
table is flat, sorted by status, every row expands to a description, and clicking a row
drives a chart underneath the table.

## Decisions

1. **Visible by default:** every defect-class attribute, plus any row that is `failed`,
   `warning` or `accepted`, plus context rows with a rate ≥ 10 %. The rest hide behind a
   footer toggle "Show N more" / "Show fewer"; the header line reads "6 shown, 12 hidden".
   Toggle state remembered in `localStorage`.
2. **Order:** failed, warning, accepted, then defect class, then notable context, then the
   rest, each group by numeric attrId.
3. **Row tint:** faint `error` / `warning` / `neutral` background on failed / warning /
   accepted rows. Passed rows plain. Notable context rows keep only the info-coloured
   rate cell.
4. **Info icon** next to the name only when there is something to say: the evaluator
   `reason`, the context-rate note, or an acceptance note. Tooltip carries that text. The
   attribute description lives in the expanded section only.
5. **Expanded section** replaces the bottom chart and row selection:
   - time-series chart for the attribute over the page's range;
   - status timeline from diary `attribute-status-changed` entries for this attribute,
     newest first, max 5: "failed since 12 Mar 2026 (was passed, value 1)";
   - value milestones: first reading at the current value, first non-zero reading;
   - acceptance history for the attribute (active and past, with notes);
   - description, norm/worst/thresh and raw string as now.
6. **Expansion:** any number open; on load the first failed/warning row is open, else none.
7. **Columns unchanged**; sparkline stays.

## API

`LatestAttribute` gains:

- `statusChanges: { at, from, to, value }[]` newest first, max 5, from
  `DiaryEntry` where `subjectType = 'disk'`, `subjectId = diskId`,
  `eventType = 'attribute-status-changed'`, `data.attrId = attrId`. One query per disk,
  grouped in the service.
- `statusSince: Date | null` — `at` of the newest change whose `to` equals the current
  status, else null.
- `valueSince: Date` — `takenAt` of the earliest reading in the unbroken run of the
  current `transformedValue` (walk back from the latest reading).
- `firstNonZeroAt: Date | null` — earliest `takenAt` with `transformedValue > 0`.

## Tasks

1. `server/`: the four fields, tests.
2. `app/`: table rework per decisions; remove the bottom chart and `selected` model;
   tests.
