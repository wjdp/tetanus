---
type: task
status: done
---

# More inventory fields

The inventory covers buying a disk and how it was fitted. It has nothing for where a
disk is when it isn't plugged in, or for proving a purchase and following a warranty
claim through, and it has no way to group disks loosely.

## Problem

The inventory replaced a spreadsheet (001). The registry is purpose, display model,
purchase date, price, supplier, condition, warranty expiry, 3.3 V pin and recording
tech, plus the alias and notes. Things people keep track of that have no home yet:

- **Where a spare or offline disk is.** [061](061-Physical-bay-mapping.md) records
  where a connected disk is plugged in. A spare in a drawer, a cold backup or an
  offsite disk has no location at all.
- **Proof of purchase.** A warranty claim asks for an order or invoice number. The RMA
  sheet ([020](020-Warranty-nudge.md)) has nowhere to get one.
- **The seller's warranty.** Used and refurbished sellers often give their own cover
  (90 days to a year), separate from the manufacturer's. Shucked disks usually have
  neither, and `warrantyExpiry` holds only one date.
- **An RMA in progress.** Disposal kind `rma` records the date sent, but not the case
  number, so you can't chase a claim or match the replacement disk to it.
- **Where a shucked disk came from.** The external drive it was taken out of (e.g. "WD
  Elements 14 TB") matters for warranty claims and for spotting batches.
- **Loose grouping.** `spare`, `cold-backup`, `offsite`, `for-sale`. Purpose is a single
  enum (`system`, `other`) and `other` has no real use today.

## Context

- Fields are registry entries in `shared/inventory-fields.ts`, of type `text`, `date`,
  `money`, `enum` or `boolean`. Each has an optional `group` (identity, hardware,
  placement, ownership), `description` (shown as an info popover) and `vendors`/`media`
  visibility gates (`isFieldVisible`). They're stored in the `Disk.inventory` JSON
  column, so no migration.
- The disk page edits each field inline (`InlineField`, [066](066-Disk-page-redesign.md));
  the list edits them in place ([067](067-Editable-inventory-list.md)); export is
  [060](060-Inventory-export.md).
- Disposal is its own column (`disposalSchema` in `shared/schemas/disks.ts`:
  `kind`, `on`, `salePrice` for `sold` only), not inventory.
- 061 (done) gives each disk a location key (enclosure slot or `ID_PATH`) and a
  per-host bay label, shown as an editable Bay fact in Placement. The fact stays after
  the disk is unplugged, dimmed as "last known". Moving bays writes a `moved-bay`
  diary entry. A USB disk's bay is its USB port path (`ID_PATH`), so the adaptor
  question is answered there and in [078](078-USB-bridge-splits-a-disk-into-two-records.md).
- BPID (done, [031](031-Vendor-detection-and-vendor-specific-inventory-fields.md)), vendor
  override ([080](080-Vendor-override-warranty-check-links-and-vendor-SMART-hints.md)) and the device type override / exclusion (073) are covered in
  their own docs.

## Design

### Fields

| Key | Label | Type | Group | Visible when |
|---|---|---|---|---|
| `storageLocation` | Stored at | text | placement | disk not present |
| `orderRef` | Order ref | text | ownership | always |
| `sellerWarrantyExpiry` | Seller warranty | date | ownership | always |
| `shuckedFrom` | Shucked from | text | identity | condition is shucked, or once set |
| `tags` | Tags | tags (new type) | ownership | always |

- **Stored at** is free text that autocompletes from values already used across the
  fleet, so "drawer" isn't spelt three ways. It shows in Placement while the disk is
  not present (spare on a shelf, unseen, missing), above the dimmed last-known Bay, so
  both "where it is" and "where it was" are visible. When the disk turns up in a host
  it is hidden, not cleared, so it comes back if the disk is unplugged again. Hidden for
  disposed disks: the disposal record says where it went.
- Changing Stored at writes a `moved-storage` diary entry ("stored at drawer", or
  "moved from drawer to offsite"), so the diary shows the shelf as well as 061's bays.
  The disk PATCH service already writes auto events for disposal and replacement;
  inventory fields write none yet, so this is the first, written there, not by the
  client.
- **Shucked from** autocompletes from values already used, like Stored at.
- **Seller warranty** is always shown, not only for used or refurbished: retailers add
  their own cover to new disks too, and the field shouldn't prescribe usage. The warranty countdown and the 020 nudge use the later of the
  two expiry dates and say which one it is.
- **Order ref** is printed on the 020 RMA sheet.
- **Tags**: a new `tags` field type, a string array that's trimmed, lowercased, with
  duplicates removed, and each tag limited to `[a-z0-9-]{1,32}`. It's a chip input on the
  disk page with autocompletion from tags already in use, and a filter and column on
  the disk list.

### Purpose `other` goes

Tags replace it. `PURPOSES` becomes `["system"]`; a migration clears any stored
`purpose: "other"` (a data migration over `Disk.inventory`, no schema change). Update
the demo fleet, the inventory filter (`useInventoryQuery`, `filterDisks`),
`displayName` and the Purpose description. Purpose stays an enum with one value, so it
still reads as "set by hand" against the inferred `system`.

### Visibility gates

`when?: (context) => boolean` landed with BPID (031, 2026-10-04); `FieldVisibilityContext`
holds `media`, `vendor` and `inventory`, and the 3.3 V pin already uses it (shucked or
recorded). Stored at also needs `present` and `disposal` in the context; the disk payload
already carries both. A hidden field keeps its value and still exports.

## Out of scope

- Burn-in tracking: no consistent practice or model for it yet.
- Per-disk temperature limits.
- Bay labels and enclosure discovery (061).
- BPID (031) and vendor override (080), device type override and exclusion (073).
- Tag management (rename or merge across disks).
- RMA case number on the disposal record: deferred to [020](020-Warranty-nudge.md),
  whose RMA sheet is its main use.

## Decisions

- No "not system" override: system detection comes from `/` and `/boot` mounts and is
  trusted for now. Revisit if a wrong inference turns up.

## Implementation

Built 2026-10-04:

- Registry: `storageLocation`, `shuckedFrom` (both `suggest: true`), `orderRef`,
  `sellerWarrantyExpiry`, `tags`. `FieldVisibilityContext` gains `present` and `disposal`.
- Text suggestions are a native `<datalist>` on the inline input, fed by
  `fleetSuggestions` over the disk list; tags use `UInputMenu` (multiple, create-item).
- `effectiveWarranty` in `shared/warranty.ts` picks the later expiry; the server's
  `warrantyDaysLeft`, the headline figure, the Ownership countdown and the list column
  follow it and say "seller" when it is the seller's.
- `moved-storage` diary entries from `updateDisk`.
- Migration `0029_clear_purpose_other`; the demo's P3 is tagged `media` instead.
- List: Stored at, Order ref, Shucked from and Tags columns; a tag filter in the Filters
  popover, shown once any disk has a tag. A disk matches a tag among several.
- Browser-checked 2026-10-05: tags editor.
