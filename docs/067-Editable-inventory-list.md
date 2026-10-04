---
type: task
status: todo
---

# Editable inventory list

Fill inventory fields across many disks from the `/disks` table instead of visiting
every disk page. Depends on the inline field editor from
[066 Disk page redesign](066-Disk-page-redesign.md) and the column registry from
[050](050-Disk-list-columns-and-views.md).

## Why

Entering the author's fleet went: open a disk, fill fields, remember to save, back
to the list, next disk; then decide to record a field differently and do it all
again, with no record of which disks were done. Fifty disks and eight fields is a
spreadsheet job, and the list is the spreadsheet.

Decided 2026-10-04: an edit mode on the table, not a separate bulk-edit page and not
a multi-row "set field to value" action. The common case is a different value per
disk (price, date, supplier), which only a grid serves.

## Edit mode

- Toggle `UButton` `i-lucide-pencil` "Edit" in the toolbar beside Columns and the
  view toggle; `color="primary" variant="soft"` while on. Table only: hidden in
  cards view and below `md`. Not in the URL or the cookie; leaving the page ends it.
- Which columns show while editing is open (§Unanswered questions); the editable
  cells are whichever editable columns are visible.
- Row click no longer navigates; the alias cell keeps a small `i-lucide-arrow-right`
  link to the disk page.
- Editable columns: alias, purpose, purchased, price, supplier, condition, warranty,
  3.3 V, recording (HDD rows only), display model. Notes is not editable here
  (multi-line); every other column renders as today.
- Each editable cell is `InlineField` `compact`: display mode shows the cell's
  normal rendering (`InventoryCell` output), click or Enter edits in place. The cell
  stays the same height.
- Commit sends the same single-key `PATCH /api/disks/:id` as the disk page; the
  row's disk is replaced from the response in `allDisks` so sorting and facet
  counts follow. Error stays in the cell as on the page.
- Disposed rows are editable when shown.

## Keyboard

Spreadsheet moves, nothing more:

- Tab / Shift-Tab: commit, move to the next / previous editable cell in reading
  order (across the row, then down).
- Enter: commit, move down one row in the same column and open it. This is the
  fill-a-column motion. Shift-Enter moves up.
- Escape: revert, stay.
- A select opens on focus in edit mode so Enter-down-pick-Enter-down works without
  the mouse.
- Focus is tracked by `(diskId, columnId)` in the table; sorting while editing keeps
  focus on the same disk.

## Finding the gaps

- In edit mode blank editable cells show their placeholder (`—`) in a dashed outline
  so unfilled fields stand out; sorting a column already puts blanks last.
- A `Missing` quick filter is not added here; the column sort plus the outline
  covers the author's case. Revisit with
  [065](065-Getting-started.md) if first-run guidance wants a checklist.

## Tests

- Page (`app/pages/disks/index.test.ts`): Edit toggles editable cells; row click does not
  navigate in edit mode; editing Supplier sends `{ inventory: { supplier } }` and
  the row updates from the response; Enter moves down one row in the same column;
  Tab moves to the next editable cell; Escape reverts.
- `InventoryTable`: Recording cell is read-only on SSD rows; Notes never editable;
  focus survives a sort.
- Cards view and below `md`: no Edit button.

## Out of scope

- Multi-select and set one value on many rows.
- Undo across cells.
- CSV paste; [060 Inventory export](060-Inventory-export.md) and its import question.

## Unanswered questions

1. Should edit mode force the Inventory group columns (plus Alias and Purpose)
   visible for the session, restoring the picker's set afterwards, or edit only the
   columns the picker already shows? Deferred 2026-10-04.
