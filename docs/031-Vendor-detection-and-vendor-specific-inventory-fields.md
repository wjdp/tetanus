---
type: task
status: todo
---

# Vendor detection and vendor-specific inventory fields

Seagate's warranty and RMA flow needs the BPID printed on the drive label. It is not
readable from any CLI, so it has to be typed in once and kept. It only makes sense for
Seagate disks, so tetanus first needs to know who made each disk. Once it does, other
vendor-aware features fall out cheaply. Feeds [020 Warranty nudge](020-Warranty-nudge.md).

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

- `shared/product-lines.ts`: hand-maintained `as const` table keyed by vendor + model regex →
  `{ line, warrantyYears }`. Code, not JSON: the keys are regexes, typecheck catches
  mistakes, and there is no UI to edit it anyway. Seed with what mars owns plus the common NAS lines:
  - Seagate: `ST\d+NM\d{3}J?` Exos 5 y; IronWolf Pro 5 y; IronWolf 3 y; BarraCuda 2 y.
  - WD: Red Pro / Gold / Ultrastar 5 y; Red Plus 3 y; `WD\d+E[MD]AZ|EMFZ|EDBZ`
    white-label shucked (no bare-drive warranty; enclosure 2–3 y); `WDS…` Blue SN 5 y.
  - Toshiba: `MG\d\d` enterprise 5 y; N300 3 y.
  - Samsung: 860/870 EVO 5 y; `MZ7KM` SM863a 5 y.
  - Intel: `SSDSC2KG|BB` DC S4x00/S3x00 5 y.
- `warrantyDefault(disk)`: purchaseDate + warrantyYears when `warrantyExpiry` is unset
  and condition is not `shucked`. Shown as a hint on the warranty field ("5 y from
  purchase → 2028-04-01, Exos default") with a one-click apply. Never written silently.
- `Disk.productLine` is not stored; derived at read time from model. Cheap and the table
  will change.

### Vendor-specific inventory fields

- `INVENTORY_FIELDS` entries gain an optional `vendors: readonly Vendor[]`. Absent means
  every disk. `inventorySchema` stays permissive on write (a field may be filled before
  detection catches up); the form and table only render fields whose `vendors` include the
  disk's effective vendor.
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

- Vendor column, filterable and groupable. Model column shows `displayModel`.
- Optional line column from the product-line table.

### Vendor-specific SMART and log hints

Mostly pointers into Phase 3 knowledge, gated on vendor so they stop being noise:

- Seagate: 1 and 7 raw values are 48-bit split counters, already handled by
  `shared/smart/transforms.ts` for 188; extend to 1/7/195 so the attribute table shows
  the meaningful piece. FARM log (`smartctl -l farm`) gives factory power-on hours
  that survive SMART resets on grey-market drives; collector addition, separate task.
- WD: shucked white-label lines get the 3.3 V pin note on the nameplate automatically
  when `pin33Taped` is unset.
- Toshiba/Samsung/Intel: nothing vendor-specific yet beyond warranty terms.

## Out of scope

- Live warranty status lookup. Vendors have no public API and scraping is brittle.
- Storing product line or warranty term on the row.
- Collector changes (FARM log) — file separately once this lands.

## Findings

(agents append here)

## Unanswered questions

1. Product-line table as code is a recommendation, not a decision. Revisit if a second
   user or a UI for editing it ever appears.
