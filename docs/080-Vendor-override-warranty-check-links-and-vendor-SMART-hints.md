---
type: task
status: todo
---

# Vendor override, warranty check links and vendor SMART hints

Split from [031](031-Vendor-detection-and-vendor-specific-inventory-fields.md) on 2026-10-04,
once BPID landed. Vendor detection, `Disk.vendor`, the `vendors`/`media`/`when` visibility
gates and the BPID field are all done there.

## Problem

Detection is sometimes wrong or blank (`other`, a USB bridge reporting its own vendor,
[078](078-USB-bridge-splits-a-disk-into-two-records.md)), and nothing lets the user
correct it. The BPID is stored but nothing uses it yet: checking a warranty still means
finding the vendor's checker and copying serial, model and BPID by hand. Some SMART raw
values are only meaningful once the vendor is known.

## Contract

### Vendor override

- `vendorOverride` inventory enum field over the closed `Vendor` list, group identity.
  Effective vendor = `vendorOverride ?? Disk.vendor`.
- Resolve it on the server so the payload's `vendor` is already the effective one, and
  keep the detected value as `detectedVendor` for the "detected as" hint. Every consumer
  (visibility gates, `displayModel`, the vendor column and filter, warranty links) then
  follows the override without each one knowing about it.
- `displayModel` takes the effective vendor too. Checked 2026-10-04: `stripVendorPrefix`
  only strips a prefix that belongs to the given vendor, and detection tries the model
  prefix first, so a model with a recognisable prefix is never misdetected. The override
  therefore only changes stripping where the old vendor was wrong and the model carries
  the right one's prefix, which is the correct result. Harmless; do it for consistency.

### Warranty check links

- `shared/warranty-links.ts`: `warrantyCheckUrl(disk) -> { url, copy: Record<string,
  string> } | null`. Where the vendor's checker accepts a query string, prefill it;
  otherwise link to the form and surface the values to paste (serial, model, BPID).
  Seagate, WD (also covers HGST), Toshiba, Samsung, Intel/Solidigm to start.
- Disk page nameplate: "Check warranty" link, plus a "needs BPID" nudge for Seagate disks
  without one.

### Inventory table

- Done in 033: vendor column and filter; model column shows `displayModel`. Grouping and a
  line column (`specs.line`) still open.

### Vendor-specific SMART and log hints

Mostly pointers into Phase 3 knowledge, gated on vendor so they stop being noise:

- Seagate: 1 and 7 raw values are 48-bit split counters, already handled by
  `shared/smart/transforms.ts` for 188; extend to 1/7/195 so the attribute table shows
  the meaningful piece. FARM log (`smartctl -l farm`) gives factory power-on hours
  that survive SMART resets on grey-market drives; collector addition, separate task.
- WD: shucked white-label lines get the 3.3 V pin note on the nameplate automatically
  when `pin33Taped` is unset.
- Toshiba/Samsung/Intel: nothing vendor-specific yet beyond warranty terms.
- Power-on hours rollover (noted 2026-10-04): some drives report attribute 9 as a 16-bit
  counter that wraps at 65,535 h (about 7.5 years), so a long-lived disk suddenly reads
  young. Starosdev's scrutiny detects the wrap from history; tetanus doesn't. Not strictly
  vendor-gated, but it belongs with the other raw-value quirks in
  `shared/smart/transforms.ts`.


## Out of scope

- Live warranty status lookup. Vendors have no public API and scraping is brittle.
- Collector changes (FARM log), a separate task.

## Questions

1. Is the "needs BPID" nudge only a hint on the disk page, or worth a new
   `inventory-incomplete` fault ([036](036-Faults-page.md) lists it as planned; it does
   not exist yet)?
