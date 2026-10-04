---
type: task
status: todo
---

# Vendor detection and vendor-specific inventory fields

Seagate's warranty and RMA flow needs the BPID printed on the drive label. It is not
readable from any CLI, so it has to be typed in once and kept. It only makes sense for
Seagate disks, so tetanus first needs to know who made each disk. Once it does, other
vendor-aware features fall out cheaply. Feeds [020 Warranty nudge](020-Warranty-nudge.md).

Landed via [033](033-Media-interface-and-drive-specs.md) on 2026-09-29: `shared/vendor.ts`
`detectVendor` (model prefix → WWN OUI → `model_family` → dataset `brand`), the `Disk.vendor`
column set on observe (lsblk fills it as a hint), `displayModel` in `shared/model.ts`, the
`vendors`/`media` visibility gate on `INVENTORY_FIELDS` (`isFieldVisible`), the vendor
column and filter on the disks list, `shared/product-lines.ts` as `WARRANTY_YEARS_BY_LINE`
keyed by dataset `line` with `warrantyDefault`, and the warranty hint with one-click apply
on the inventory form. Remaining here: `vendorOverride`, BPID, warranty check links, SMART
hints. Correction: the Intel OUI is `5cd2e4`, not `55cd2e` (033 findings, T4).

Decided 2026-09-28: vendor is a stored `Disk.vendor` column derived on observe; vendor-specific
fields extend the existing `inventory` JSON registry rather than adding columns. Override is
an inventory field, not a column write. HGST stays its own vendor: the drives predate the
merger and the pattern recurs (SanDisk, Solidigm). Seagate's checker does require BPID
today (observed 2026-09-28; it did not previously).

## Contract

### Vendor detection

- `shared/vendor.ts`: `detectVendor({ model, wwn, modelFamily }) -> Vendor | null`, pure,
  usable by app and server. `Vendor` is a closed enum:
  `seagate | western-digital | toshiba | samsung | intel | hgst | micron | crucial |
  kingston | sandisk | other`.
- Inputs in priority order; first hit wins, later ones only fill a blank:
  1. Model prefix table. `ST` → seagate; `WDC `, `WD`, `WDS` → western-digital;
     `TOSHIBA` → toshiba; `Samsung`/`SAMSUNG`/`MZ` → samsung; `INTEL`, `SSDSC2`,
     `SSDPE` → intel; `HGST`, `Hitachi`, `HUS`, `HUH` → hgst; `CT` → crucial;
     `Micron`/`MTFD` → micron; `KINGSTON` → kingston; `SanDisk` → sandisk.
  2. WWN OUI (24 bits after the NAA nibble). Seagate `0004cf`, `000c50`; WD `0014ee`;
     Toshiba `000039`; Samsung `0002c3`, `002538`; Intel `001b21`, `55cd2e`; HGST
     `000cca`; Micron `00a075`. Covers disks whose model is blank (mars K6 in the
     scrubbed fixtures reports `model_name: null`).
  3. smartctl `model_family` first word (`Seagate …`, `Western Digital …`, `Toshiba …`).
  - udev `ID_VENDOR` is `ATA` for every SATA disk; ignore it.
- WWN currently lives only in `DiskKey` (kind `wwn`), so `observeDisk` passes the
  observation's WWN into detection before keys are stored.
- `Disk.vendor` (text, nullable) set on every identity observation. A `vendorOverride`
  inventory enum field wins when set, for the `other` and misdetected cases.
- Model display: `displayModel(model, vendor)` strips a redundant vendor prefix
  (`WDC WD120EMAZ-11BLFA0` → `WD120EMAZ-11BLFA0`, `TOSHIBA MG09ACA18TE` → `MG09ACA18TE`).
  Stored model stays verbatim; it is an identity key.

### Product line and warranty term

Revised 2026-09-29: [033](033-Media-interface-and-drive-specs.md) lands first and supplies
`specs.line` from the vendored drive dataset (plus `overrides.json`), so the table below
becomes `Record<line, warrantyYears>` keyed by that string and the model regexes go.

- Done in 033: `shared/product-lines.ts` is `WARRANTY_YEARS_BY_LINE: Record<line, years>`
  keyed by the dataset's `line` string, with `warrantyYearsFor` and `warrantyDefault`;
  a test asserts every key exists in the snapshot or overrides. White-label WD lines and
  lines with no confident term (SkyHawk AI, IronWolf 125/525, Enterprise Capacity V5) are
  absent. The hint with one-click apply is on the inventory form. Product line lives on
  `Disk.specs.line`, not its own column.

### Vendor-specific inventory fields

- Done in 033: `INVENTORY_FIELDS` entries take optional `vendors` / `media` gates,
  checked by `isFieldVisible`; `inventorySchema` stays permissive on write. Effective
  vendor = `vendorOverride ?? Disk.vendor` once the override exists.
- First field: `{ key: "seagateBpid", label: "BPID", type: "text", vendors: ["seagate"] }`.
  Validation: trim, uppercase, `[A-Z0-9]{1,16}`. Shown on the nameplate next to serial
  when set, and in the RMA sheet (020).

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
- Storing product line or warranty term on the row.
- Collector changes (FARM log) — file separately once this lands.

## Findings

(agents append here)

## Unanswered questions

1. Product-line table as code is a recommendation, not a decision. Revisit if a second
   user or a UI for editing it ever appears.
2. Should `vendorOverride` also re-run `displayModel` stripping, or only gate fields and
   warranty links?
