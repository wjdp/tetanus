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
- Landed 2026-10-04 as payload resolution, not a stored column: `Disk.vendor` stays the
  detected value, `effectiveVendor` (`shared/vendor.ts`) applies the override in
  `summarise` (`server/services/disks.ts`) and in SMART ingest (`ataSsdAttributesFrom` in
  `server/services/smart.ts`). Chosen over the `recordingTech` pattern (resolve into the
  column, re-derive on edit) because clearing the override then needs no re-detection
  from WWN and `specs.brand`. The disk page edits it inline under Identity, with a
  "detected as" hint.

### Warranty check links

- `shared/warranty-links.ts`: `warrantyCheckUrl(disk) -> { url, copy: Record<string,
  string> } | null`. Where the vendor's checker accepts a query string, prefill it;
  otherwise link to the form and surface the values to paste (serial, model, BPID).
  Seagate, WD (also covers HGST), Toshiba, Samsung, Intel/Solidigm to start.
- Disk page: "Check warranty" link in the Ownership pane, plus a "needs BPID" nudge on the nameplate for Seagate disks
  without one.
- Landed 2026-10-04: `warrantyCheckUrl` and `needsBpid` in `shared/warranty-links.ts`,
  returning `{ url, copy, note? }`; the Ownership pane's "Check warranty" popover
  (`DiskWarrantyCheck.vue`) lists the values with copy buttons. Both are hidden on
  disposed disks. UK URLs for Seagate and WD; no region setting.
- Checkers, researched 2026-10-04. None documents a prefill query string, so every vendor
  is link + values to copy until one is found by testing:

  | Vendor | Checker | Asks for |
  |---|---|---|
  | Seagate | `https://www.seagate.com/gb/en/support/warranty-and-replacements/` | serial, last 4 of BPID (when required), or part number; capacity; country |
  | WD, HGST | `https://support-en.wd.com/app/warrantystatusweb` | country, serial(s). Flash/SSD redirects to SanDisk support |
  | Toshiba | `https://myapps.taec.toshiba.com/myapps/admin/jsp/webrma/addRequest1NoLogin.jsp?Action=NEW` | serial(s); 3.5" desktop drives need the full T-S/N, label suffix included |
  | Intel, Solidigm | `https://support.solidigm.com/en-US/serial-number/` | serial (ISN/SN), captcha |
  | Samsung | none online | consumer SSD claims go through retailer or service centre; link the warranty policy page `https://semiconductor.samsung.com/consumer-storage/support/warranty/` |

  - Seagate wants only the last 4 BPID digits; `copy` should surface that, not the whole
    value.
  - Seagate and WD are region-localised (`/gb/en/`, `support-en`). Pick region from a
    setting or leave the UK URLs; not decided.
  - Toshiba's serial on the label may carry characters smartctl doesn't report; the copy
    hint should say so.

### Inventory table

- Done in 033: vendor column and filter; model column shows `displayModel`. Grouping and a
  line column (`specs.line`) still open.

### Vendor-specific SMART and log hints

Mostly pointers into Phase 3 knowledge, gated on vendor so they stop being noise:

- Seagate 1/7: nothing to do. Checked 2026-10-04: smartctl's drive database already
  formats them as `errors/operations` (`0/66089904` on the Exos X18 fixtures), and the
  default `leadingInteger` transform takes the error count. 195 appears on no Seagate
  fixture; capture one before touching it. FARM log (`smartctl -l farm`) gives factory
  power-on hours that survive SMART resets on grey-market drives; collector addition,
  separate task.
- WD: shucked white-label lines get the 3.3 V pin note on the nameplate automatically
  when `pin33Taped` is unset. The dataset already marks them: `overrides.json` gives
  `line` values starting `White label` (e.g. `White label (Ultrastar He12)` for
  WD120EMAZ), so the gate is `specs.line` prefix.
  Landed 2026-10-04: `isWhiteLabel` in `shared/inventory-fields.ts`; the nameplate notes
  the pin and the `pin33Taped` field shows on white-label lines as well as shucked disks.
- Toshiba/Samsung/Intel: nothing vendor-specific yet beyond warranty terms.
- Power-on hours rollover: split to [081](081-Power-on-hours-counter-wraparound.md).

## Out of scope

- Live warranty status lookup. Vendors have no public API and scraping is brittle.
- Collector changes (FARM log), a separate task.

## Questions

1. Is the "needs BPID" nudge only a hint on the disk page, or worth a new
   `inventory-incomplete` fault ([036](036-Faults-page.md) lists it as planned; it does
   not exist yet)?
