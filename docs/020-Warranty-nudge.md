---
type: task
status: planned
---

# Warranty nudge

Stub. Prompt the author before a warranty expires, and make a claim easy. After
Phase 4 inventory fields ([004](004-Project-plan.md)).

## Sketch

- Alert rule: `warrantyExpiry` within 6 weeks (setting) → one notification
  suggesting a long self-test while a claim is still possible; diary entry on the
  disk. Recovery not needed.
- RMA sheet: `GET /api/disks/:id/rma` renders one page (or markdown) with model,
  serial, firmware, purchase date/price/supplier, warranty expiry, current failed
  attributes with values, self-test log, relevant diary and ZFS events. Print from
  the disk page.
- RMA case number: `rmaCase` on the disposal record (`kind === "rma"` only, like
  `salePrice` for `sold`), shown in the disposal banner and on the sheet. Deferred here
  from [076](076-More-inventory-fields.md).
- Inventory table: warranty countdown already planned in Phase 6; this adds the
  nudge and the sheet.

## Unanswered questions

1. Six weeks, or tie the lead time to the supplier's claim window?
