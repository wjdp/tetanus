---
type: task
status: planned
---

# Manual disk creation

Stub. Every `Disk` row comes from a collector sighting or the scrutiny importer; there
is no way to add a disk by hand.

## Problem

The inventory claims to know every disk you own, but it can only know disks a collector
has seen. Missing:

- a new disk still in its box, bought with a warranty that is already ticking;
- a cold spare on the shelf that was never plugged into a monitored host;
- disks in machines without a collector (a laptop, a Pi, a Windows box, a friend's
  server you lent one to);
- the disks the removed Obsidian importer used to cover
  ([012](012-Phase-4-disks-identity-and-state.md) step 6, the H1–H4 rows).

Today the only workaround is to plug the disk into a monitored host for one SMART
cycle so a sighting creates the row.

## Context

- `Disk` identity is `DiskKey` rows (serial, WWN, …) matched in
  `server/services/identity.ts`; `firstSeenAt`, `lastSeenAt`, `lastSeenHostId` are all
  sighting-driven and assumed non-null in places.
- `Disk.lastState` is inferred from presence and ZFS membership
  (`server/services/disks.ts`), with `stateOverride` on top. A never-seen disk has no
  presence to infer from.
- The scrutiny importer (`server/services/importers/scrutiny.ts`) already creates
  rows for disks the collector has never seen, so a sighting-less disk exists as a
  shape; what it looks like in lists, faults and the diary is worth checking.
- Inventory fields are registry-driven (`shared/inventory-fields.ts`); `PATCH
  /api/disks/:id` edits them. There is no `POST /api/disks`.
- A hand-created disk that is later seen by a collector must merge into the same row,
  not create a duplicate; the identity match is on serial/WWN, so the manual row needs
  at least one of those.
- Disposal ([040](040-Disk-disposal.md)) and RMA replacement links
  (`Disk.replacesDiskId`) should work for manual disks too.

## Questions

1. Minimum fields for a manual disk: serial only? Model and capacity?
2. What state does a never-seen disk show, and does it ever raise "missing"?
3. Bulk entry (paste a CSV) in scope, or one at a time?
