---
type: task
status: planned
---

# Inventory export

Stub. No way to get the inventory or the diary out of tetanus as a file.

## Problem

The inventory replaces a spreadsheet; people moving off a spreadsheet want to know they
can move back. Uses:

- a CSV of every disk with its inventory fields, state, host, pool, age and SMART
  summary, for insurance, a warranty claim or a sale listing;
- a markdown or JSON dump of a disk's diary;
- a backup of the hand-entered data (inventory, diary, acceptances, notes) that is
  smaller and more readable than the SQLite file.

The per-disk diagnostics export ([041](041-Disk-diagnostics-export.md)) is a different
thing: raw collector output for a bug report, not the user's own data.

## Context

- Inventory fields are registry-driven (`shared/inventory-fields.ts`) with types
  (date, money, enum, boolean), so a column list can be derived rather than
  hand-written. Currency comes from settings ([051](051-Currency-setting.md)).
- The disk list page already computes the derived columns (age, warranty countdown,
  wear) per view ([050](050-Disk-list-columns-and-views.md)); an export of "what I am
  looking at" is one shape, an export of everything is another.
- `DiaryEntry` holds manual and auto events with markdown bodies.
- Disposed disks drop out of lists by default ([040](040-Disk-disposal.md)); an
  export should probably include them.

## Questions

1. CSV of the current list view, a full JSON dump, or both?
2. Is round-tripping (import the export) a goal? That decides whether the format is for people or for tetanus.
