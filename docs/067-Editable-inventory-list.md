---
type: task
status: done
---

# Editable inventory list

Fill inventory fields across many disks from `/disks` instead of visiting every disk
page. Builds on the inline field editor from [066 Disk page redesign](066-Disk-page-redesign.md)
and the column registry from [050](050-Disk-list-columns-and-views.md).

## Why

Entering the author's fleet went: open a disk, fill fields, remember to save, back
to the list, next disk; then decide to record a field differently and do it all
again. Fifty disks and a dozen fields (more since
[076](076-More-inventory-fields.md)) wants a quick walk through the fleet without
leaving the list.

## Decisions

- 2026-10-04: in-list editing, not a separate bulk-edit page, and not a multi-row
  "set field to value" action. The common case is a different value per disk.
- 2026-10-05: an edit drawer, not editable table cells. Inline cells in a table and
  cards had too many edge cases (keyboard grid, row height, which columns show,
  table-only). This closes the open question on forcing columns visible.

## Design

### Opening

- Each table row ends with a ghost `i-lucide-pencil` button ("Edit <label>"); each
  card has one in its corner. Row and card click still navigate to the disk page.
- Works in table and cards view, at every width.

### Drawer

- `USlideover` from the right. Header: media glyph, disk label and display model on
  the left; a pager (up, "3 / 32", down), a link to the disk page and close on the
  right. Buttons only, no keyboard shortcuts (they would clash with typing).
- Stepping keeps the current disk on screen until the next has loaded, and the
  drawer prefetches the neighbours, so the pager does not flash a spinner.
- Prev/Next step through the list's visible disks in their current sort, grouping
  and filter, as a snapshot taken when the drawer opens, so a disk does not jump
  away from under you when an edit changes its sort position.
- Body: every user-editable field, grouped like the disk page, with the same
  visibility gates (`isFieldVisible`) and the same editors:
  - Identity: alias, model and serial (read-only), vendor, BPID, shucked from,
    display model
  - Hardware: recording
  - Placement: stored at, bay label, purpose
  - Ownership: the disk page's `DiskOwnership` (warranty hints, seller warranty,
    replaces)
  - Notes: the disk page's `DiskNotes`
- The drawer loads the disk's detail (`GET /api/disks/:id`) and saves with the same
  single-key `PATCH`. Each response replaces the disk in the list's data, so the
  table, cards, sort and facet counts follow.
- Disk page and drawer share the editable fields through one component
  (`DiskEditableField`) so displays, hints and gates do not drift.

### New columns

Purpose (Placement) and Display model (Identity), hidden by default, read-only in
the table. Purpose shows the badge, italic when inferred. Display model shows the
resolved short name, dimmed when it is a fallback rather than set by hand.

## Tests

- Page: pencil opens the drawer for that disk without navigating; editing a field
  sends the PATCH and the row updates; Next and Prev follow the visible order and
  stop at the ends; the order is a snapshot.
- Drawer: shows the gated fields per disk (BPID only for Seagate, recording only
  for HDD).
- Table: Purpose and Display model columns render.

## Out of scope

- Multi-select and set one value on many rows.
- Undo across fields.
- CSV paste; [060 Inventory export](060-Inventory-export.md) and its import question.
- A `Missing` quick filter; revisit with [065](065-Getting-started.md).
