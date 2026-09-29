---
type: task
status: todo
---

# Media, interface and drive specs

The disks list cannot say which disks are spinning rust and which are flash, nor what bus
they speak: `Disk.protocol` is smartctl's view (`ata|nvme|scsi`) and `Disk.transport` is
lsblk's `TRAN`, and on mars the two disagree for every disk behind the IT-mode SAS HBA:
all of them are SATA drives, so smartctl (SAT passthrough) says `protocol: ata` while
lsblk reports the HBA link, `transport: sas` (renamed `link` below). Only the four motherboard-attached SSDs
(sdo, sdq, sdr, sds) read `sata` on both. SMR is invisible to every command we run.
Spec'd 2026-09-29.

Decided 2026-09-29: columns for the filterable fields, JSON for the rest; `Disk.transport`
renamed `link`; Backblaze fields kept; this task lands before
[031](031-Vendor-detection-and-vendor-specific-inventory-fields.md), so the dataset is the
primary source of product line and 031's table shrinks to warranty terms; models the
dataset misses go in a local `overrides.json`, contributed upstream later.

Three layers, each cheaper and more trustworthy than the next:

1. **Observed** (smartctl, lsblk): media, interface, link speed, sector format, TRIM.
2. **Inferred** (drivedb family suffix, TRIM-on-HDD tell): recording technology.
3. **Looked up** (open dataset by exact model): cache, helium, NAND type, TBW, PLP,
   Backblaze failure rate. Fills the gaps observation cannot.

## Observed today (mars fixtures, smartctl 7.5)

| Disk | smartctl `device` | `rotation_rate` | `form_factor` | `sata_version` / `interface_speed` | `trim` | lsblk `TRAN` / `ROTA` |
|---|---|---|---|---|---|---|
| WD120EMAZ (sda) | `sat` / ATA | 5400 | 3.5 inches | SATA 3.2 / 6.0 Gb/s max+current | false | sas / true |
| MZ7KM480 (sdm) | `sat` / ATA | 0 | 2.5 inches | SATA 3.1 / 6.0 Gb/s | true, deterministic, zeroed | sas / false |
| 870 EVO (sdr) | `sat` / ATA | 0 | 2.5 inches | SATA 3.3 / 6.0 Gb/s | true | sata / false |
| WDS250G3X0C (nvme0) | `nvme` / NVMe | absent | absent | absent (`nvme_version` 1.3, `nvme_pci_vendor`) | absent | nvme / false |

Also present on ATA: `ata_version`, `logical_block_size`, `physical_block_size` (4096 on
the WDs, 512 on the SSDs). NVMe: `logical_block_size` only. The `xall-*.json` (non
`-auto`) fixtures were forced `-d scsi` and are what the collector must **not** send:
model null, `scsi_transport_protocol: SAS`. The collector already auto-detects.

A pure SAS drive would report `device.protocol: SCSI`, `scsi_vendor`/`scsi_product`,
`scsi_transport_protocol.name: SAS (SPL-x)` and `rotation_rate`. None on mars (the HBA
speaks SAS and SATA; every drive on it is SATA), so add a synthetic fixture from
`test/fixtures/scrutiny/smart-scsi.json`. Expected mars result: 15 × `SATA via SAS`,
4 × `SATA`, 1 × `NVMe`.

## Contract

### Parser (`server/ingest/smartctl-xall.ts`)

`SmartctlXallIdentity` gains, all optional:

```ts
deviceType: string;            // device.type: sat | ata | nvme | scsi | megaraid,N …
sataVersion: string;           // sata_version.string      "SATA 3.3"
ataVersion: string;            // ata_version.string
linkSpeedMaxBps: number;       // interface_speed.max.units_per_second * bits_per_unit
linkSpeedCurrentBps: number;   // interface_speed.current…
trimSupported: boolean;        // trim.supported
logicalBlockSize: number;
physicalBlockSize: number;
scsiTransport: string;         // scsi_transport_protocol.name
nvmeVersion: string;           // nvme_version.string
```

`lsblk.ts` already parses `rota`; pass it through to `observeLsblk` as an identity hint.
No collector change required for the core of this task (see Optional below).

### Classification (`shared/hardware.ts`, pure)

```ts
type Media = "hdd" | "ssd" | "unknown";
type Interface = "sata" | "sas" | "nvme" | "usb" | "unknown";   // what the drive speaks
type RecordingTech = "cmr" | "smr" | "unknown";                  // hdd only; ssd → null
```

- `media`: `rotationRate > 0` → hdd; `rotationRate === 0` → ssd; protocol `nvme` → ssd;
  else lsblk `rota` (false → ssd, true → hdd; lowest priority, USB bridges and HBAs lie);
  else unknown.
- `interface`: `sataVersion` present or `deviceType === "sat"` → sata; protocol `nvme` →
  nvme; protocol `scsi` with `scsiTransport` starting `SAS` → sas; lsblk `tran === "usb"`
  with protocol `ata` → sata (link usb); protocol `scsi` otherwise → unknown.
- `link`: lsblk `tran` verbatim (`sata | sas | nvme | usb | …`), the renamed `transport`
  column. Display `SATA via SAS`
  when `interface !== link`, `SATA` when equal or link unknown. NVMe is always PCIe; the
  M.2/U.2/AIC distinction comes from the dataset's `form_factor`.
- `linkSpeed`: `{ maxBps, currentBps }` when both present. `current < max` is a
  negotiated-down link (cable, backplane, port), later an alert; store now.
- `sectorFormat`: derived at read time: `512n` (512/512), `512e` (512/4096), `4Kn`
  (4096/4096), else null. Matters for `ashift` and for mixing in a vdev.
- `recordingTech` (hdd only), first hit wins:
  1. Inventory override `recordingTech` (enum `cmr | smr`).
  2. Dataset match `recording_tech`.
  3. `modelFamily` suffix `(CMR)`, `(SMR)`, `(CMR+HAMR)` → cmr/smr; family
     `Seagate Archive HDD (SMR)` covered by the same regex.
  4. `trimSupported === true` on an hdd → smr with `recordingTechInferred: true`
     (drive-managed SMR advertises TRIM; CMR HDDs do not).
  5. unknown. Host-managed/host-aware SMR would show in lsblk `ZONED`; nobody buys
     those for a NAS, so Optional.

### Schema (`Disk`, migration `add_disk_hardware`)

Columns for what is filtered or sorted on; JSON for the rest.

```
media             text  Media
interface         text  Interface
link              text  renamed from transport (lsblk TRAN); same migration
recordingTech     text  RecordingTech | null
logicalBlockSize  integer
physicalBlockSize integer
trimSupported     integer (boolean)
hardware          json  { sataVersion, ataVersion, nvmeVersion, scsiTransport, deviceType,
                          linkSpeed: { maxBps, currentBps } }
specs             json  DriveSpec | null   (dataset record, see below)
```

Set on every smartctl identity observation via `definedFields`, same path as
`rotationRate`. `media` and `interface` also fall back from lsblk hints so a disk with no
SMART yet still classifies. `protocol` stays; it drives which SMART table to read.
Rename touches `DiskIdentity`, `observeLsblk`, the scrutiny importer, `DiskNameplate.vue`
and the page test fixture; no data migration beyond `ALTER TABLE … RENAME COLUMN`.

### Drive spec dataset

**Source: nasdisks.com** (GitHub `deeddy/nas-drive-data`). Checked 2026-09-29:

- `https://www.nasdisks.com/data/drives.json`, 168 KB, 298 rows (192 HDD, 106 SSD).
  Specs and CMR/SMR are **CC BY 4.0**; the `afr_*`/`reliability_*` fields are Backblaze
  Drive Stats, free with attribution, not resellable.
- Keyed by exact bare model (`ST12000NM000J`, `MG09ACA18TE`, `WD80EFPX`), with
  `also_sold_as` for rebadges (`ST16000NM000J` ↔ `ST16000NM002J`).
- Fields: `brand, line, capacity_tb, rpm, cache_mb, interface (SATA|SAS|NVMe),
  form_factor (3.5|2.5|M.2|U.2), recording_tech (cmr|smr|""), erc_tler, is_helium,
  drive_class (Desktop|NAS|NAS-Pro|Enterprise|Surveillance), media_type, in_production,
  also_sold_as`; SSD-only `nand_type, tbw_tb, dwpd, has_dram, has_plp,
  sustained_write_mbps`; Backblaze `afr_pct, reliability_drive_count, reliability_drive_days,
  reliability_failures, reliability_source`.
- mars coverage: Exos X16/X18 (all `ST1x000NM00xx`) and Toshiba MG09 hit; WD white-label
  `WD120E{MAZ,DAZ,MFZ,DBZ}`, Samsung 850/860/870 EVO, MZ7KM, Intel S35xx/S45xx, WD SN750
  miss. Roughly 8 of 19 disks. Brands: WD 95, Seagate 79, Toshiba 37, Samsung 21,
  Synology 16, Kingston 12, Crucial 10, Micron 8, Sabrent 7, Solidigm 6, others.
- HDD rows carry no sustained transfer rate (`sustained_write_mbps` null for every hdd);
  SSD rows do.

Alternatives considered and rejected: smartmontools `drivedb.h` (833 entries, GPL; carries
only family name + attribute presets; the `(CMR)/(SMR)` suffix is all we can use and we
already get it via `model_family`); TechPowerUp SSD database (JSON API and MCP exist but
under a commercial licence); nascompares / TrueNAS forum SMR lists (HTML, no licence);
Backblaze raw CSVs directly (nasdisks already folds them in per model). No open source of
HDD datasheet transfer rates exists; [023 Disk stats](023-Disk-stats-ingest.md) will
measure real throughput, which is worth more.

**Integration:**

- Vendor a trimmed snapshot at `server/services/drive-db/nasdisks.json` (drop acoustic and
  Backblaze day/failure counts we do not show; keep `afr_pct` + `reliability_drive_count`
  + `reliability_source`; ~40 KB) plus `server/services/drive-db/NOTICE.md` with both attributions.
  `bin/update-drive-db.sh` (curl + jq) refreshes it; a refresh is a commit. Never fetched
  at runtime: the container makes no outbound calls beyond the ones the user configures.
- `server/services/drive-db/overrides.json`: same record shape, hand-written, for models
  the dataset misses; checked first. Seed with mars: `WD120EMAZ`/`EDAZ`/`EMFZ`/`EDBZ`
  (white-label Ultrastar He12, cmr, helium, 5400 class), `MZ7KM480HMHQ` (SM863a), 
  `SSDSC2KG480G8`/`SSDSC2BB480G7` (S4610/S3520), `Samsung SSD 850/860/870 EVO`,
  `WDS250G3X0C` (SN750). `source: "local"` on the stored spec so the panel footer shows
  it. Contribute upstream later; the file shrinks as they land.
- `server/services/drive-db/lookup.ts`: `lookupSpec(model) -> DriveSpec | null`. Index by bare model
  and by every `also_sold_as`. Normalise the smartctl model first:
  strip vendor prefix (`WDC `, `TOSHIBA `, `INTEL `, `Samsung SSD `), strip Seagate
  `-2XXXXX` and WD `-XXXXXXX` variant suffixes, strip capacity words (`870 EVO 2TB`).
  The normaliser is `shared/model.ts` `bareModel(model)`, shared with
  [031](031-Vendor-detection-and-vendor-specific-inventory-fields.md)'s `displayModel`;
  whichever task lands first creates it.
- `DriveSpec` stored on `Disk.specs` with `{ source: "nasdisks", snapshot: "2026-09-04",
  matchedModel, ...fields }`. Recomputed on observe when `model` changes or
  `specs.snapshot` differs from the bundled snapshot, so a vendored refresh propagates on
  the next collector run without a task.
- Observed wins over dataset on overlap (`rotationRate`, `formFactor`, interface); dataset
  fills nulls (NVMe form factor). Disagreement → `hardware.specMismatch: string[]`, shown
  as a dimmed note on the disk page, never a fault.
- Cross-links: `specs.tbw_tb` is the default for [019](019-SSD-endurance.md)'s `ratedTbw`
  when the inventory field is unset. `specs.line` is **the** product line; 031's
  `shared/product-lines.ts` becomes a warranty-term table keyed by the dataset's `line`
  string (`"Exos X18": 5`, `"Red Plus": 3`), with `overrides.json` supplying `line` for
  models the dataset lacks. 031 no longer needs model regexes for line detection.

### Inventory

`shared/inventory-fields.ts`: `{ key: "recordingTech", label: "Recording", type: "enum",
values: ["cmr", "smr"] }`, hdd only (needs the `vendors`-style visibility gate from 031;
here `media: ["hdd"]`). Override for the ~half of disks the dataset misses.

### UI

- **Disks list**: `Media` column (`HDD 5400` / `SSD`, icon), `Interface` column
  (`SATA`, `SATA via SAS`, `NVMe`), `Recording` column (`CMR` / `SMR` badge; `SMR` in
  `warning` colour when the disk is a pool member, `outline` when inferred), `Sectors`
  column (`512e`/`4Kn`, hidden by default). Filters: media, interface, recording.
- **Disk page nameplate**: replace the `Protocol` fact with `Interface: SATA 3.3 via SAS ·
  6.0 Gb/s` (link speed red when negotiated below max), add `Media: HDD · 7200 rpm · CMR ·
  helium` / `SSD · TLC · DRAM · PLP`, and `Sectors: 512e`.
- **Specs panel** on the disk page under inventory: dataset fields in a `dl` (line, class,
  cache, TLER, helium, NAND, TBW, DWPD, sustained write, AFR with drive count and
  `Backblaze thru Q2 2026`, in production). Footer: `Specs: nasdisks.com (CC BY 4.0) ·
  Failure rates: Backblaze Drive Stats`. Hidden when no match; a `no spec match for
  <bareModel>` line instead, so the user knows to set the override.
- **Topology rail**: media glyph on rows; nothing else.

### Optional collector change (bundle with the outstanding 028 re-capture)

Add `ZONED,LOG-SEC,PHY-SEC` to the lsblk column list: sector sizes for SCSI/NVMe when
smartctl lacks `physical_block_size`, `ZONED` for host-managed SMR. Parser treats
missing columns as unknown. Bump collector to 0.3.0. Not required for anything above.

## Follow-ups (not this task)

- Alert: SMR disk in a raidz/mirror vdev (`recordingTech === "smr" && membership`).
- Alert: link speed negotiated below max on a disk that previously ran at max.
- Alert: mixed sector formats in one vdev.
- Re-match against a vendored `drivedb.h` when the host's smartctl is old.

## Out of scope

- Runtime fetching of the dataset.
- HDD sustained transfer rate: no open source; measured by 023.
- PCIe generation and lane width for NVMe (`/sys/class/nvme/*/device/current_link_speed`):
  needs a new collector source; file separately if wanted.
- SSHD hybrids, Optane: classify as hdd/ssd by rotation rate; no special case.

## Findings

(agents append here)

### T2

- `shared/model.ts` `bareModel`: vendor prefix, trailing capacity word, then a
  `-variant` suffix only after an 8+ char alphanumeric code, so part numbers where the
  suffix matters (`HAT5320-24T`, `MZ-77Q8T0`, `SB-RKT4P-8TB`) survive. Also exports
  `modelWithoutVendor`.
- Index keys are each dataset `model`/`also_sold_as` verbatim plus its `bareModel`
  (unless two rows collide on it). Lookup tries the vendor-stripped model first, then
  the bare one. Needed because upstream keeps some suffixes (`MZ7L37T6HBLA-00W07`).
- Upstream placeholder keys (`MG08ACA16Tx`, `WUH721816ALE6Lx`) already list their real
  variants in `also_sold_as`, so no wildcard matching.
- Snapshot is 139 KB, not ~40 KB: 298 keyed rows of 24 fields, one row per line, sorted
  by model with sorted keys. Column arrays would come to ~45 KB but give unreadable
  diffs. Excluded from Biome in `biome.json`. `overrides.json` is Biome-formatted.
- Snapshot validation happens in the test, not at runtime, so a bad refresh fails
  `pnpm test` and cannot break ingest.
- Samsung consumer rows are keyed by retail part number (`MZ-77Q2T0`) but smartctl
  reports `Samsung SSD 870 QVO 2TB`, so they never match. Fix upstream or add a
  line-based index later.
- Overrides differ from the spec: mars has `SSDSC2BB480G6R` (DC S3510), not `G7`, so both
  are seeded. Dell `…R` rebadges go in `also_sold_as`. `WD120EDBZ` has its own row because
  it reports 7200 rpm. `WD120EDAZ` reports no SCT ERC, so the EMAZ group has
  `erc_tler: null`. S3520 NAND is MLC. Left null because not confirmed from a datasheet:
  S4610 TBW, SM863a DWPD, S3510 TBW, and every EVO TBW and capacity.
- For T3: `specsNeedRefresh(specs, previousModel, model)` is true when the model changed,
  the snapshot differs, or specs is null. A miss is re-checked on every observation, which
  costs one map lookup.
- mars coverage: 7/20 from nasdisks, 13/20 local, 0 misses:

| Disk | model_name | matched | source |
|---|---|---|---|
| nvme0 | WDS250G3X0C-00SJG0 | WDS250G3X0C | local |
| sda, sdb | WDC WD120EMAZ-11BLFA0 | WD120EMAZ | local |
| sdc | WDC WD120EDAZ-11F3RA0 | WD120EDAZ | local |
| sdd | WDC WD120EMFZ-11A6JA0 | WD120EMFZ | local |
| sde | WDC WD120EDBZ-11B1HA0 | WD120EDBZ | local |
| sdf | ST12000NM000J-2TY103 | ST12000NM000J | nasdisks |
| sdg | TOSHIBA MG09ACA18TE | MG09ACA18TE | nasdisks |
| sdh, sdi | ST18000NM000J-2TV103 | ST18000NM000J | nasdisks |
| sdj, sdl | ST16000NM001G-2KK103 | ST16000NM001G | nasdisks |
| sdk | ST16000NM000J-2TW103 | ST16000NM000J | nasdisks |
| sdm | SAMSUNG MZ7KM480HMHQ-00005 | MZ7KM480HMHQ | local |
| sdn | SSDSC2KG480G8R | SSDSC2KG480G8R | local |
| sdo | Samsung SSD 860 EVO 500GB | 860 EVO | local |
| sdp | INTEL SSDSC2BB480G6R | SSDSC2BB480G6R | local |
| sdq | Samsung SSD 850 EVO 500GB | 850 EVO | local |
| sdr, sds | Samsung SSD 870 EVO 2TB | 870 EVO | local |

### T4 (031 vendor detection folded in)

- `shared/vendor.ts`: `detectVendor({ model, wwn, modelFamily, brand })`; priority model
  prefix, WWN OUI, family, dataset brand (unknown brand is `other`, null when no
  evidence). Short prefixes are anchored with a following digit (`ST\d`, `CT\d`, `WDS?\d`),
  `MZ` needs an uppercase/digit/hyphen next.
- 031 typo: Intel OUI `55cd2e` is NAA nibble + 5 digits. Real 24-bit OUI is `5cd2e4`
  (mars Intel oui 6083300), which is what the table uses.
- mars WD white-label He12 disks have WWN OUI `000cca` (HGST, the maker). WWN-only
  detection says `hgst`; model prefix `WDC ` wins when present, giving `western-digital`.
- Fixtures: every `-auto.json` has a model. The K6 null-model case is the failed
  non-auto scan; tested by dropping the model and using the WWN.
- `shared/model.ts`: one prefix table (now vendor-tagged) shared by `bareModel`,
  `modelWithoutVendor` and new `displayModel(model, vendor?)`. A given vendor only strips
  its own prefixes.
- `shared/product-lines.ts`: `WARRANTY_YEARS_BY_LINE`, `warrantyYearsFor`, `warrantyDefault`.
  A test asserts every key exists as a `line` in snapshot or overrides. Left out for lack
  of a confident term: `SkyHawk AI`, `IronWolf 125/525`, `Enterprise Capacity V5`, WD
  white-label lines. `warrantyDefault` clamps 29 Feb to 28 Feb.

### T1

- mars replay (lsblk + every `-auto` smartctl + `xall-nvme0`) gives 15 × sata/sas,
  4 × sata/sata, 1 × nvme/nvme as expected. `xall-nvme0.json` has no `-auto` twin;
  it is already auto-detected (`device.type: nvme`).
- `scrutiny/smart-scsi.json` has no `scsi_transport_protocol`, so by the rules it
  classifies `interface: unknown`. Added `test/fixtures/synthetic-smartctl/xall-sas.json`
  (that fixture plus `SAS (SPL-4)`) for the sas path. The forced `-d scsi` mars fixtures
  do carry `SAS (SPL-4)`: the HBA's link, not the drive, which is why they must not be sent.
- No mars HDD advertises TRIM; the TRIM-on-HDD tell is tested with a patched identity.
  Only `sdd` (`Western Digital Red (CMR)`) has a recording suffix; every other hdd is
  `unknown` until the dataset (T3) or the override fills it.
- `interface` beyond the spec: with no smartctl protocol, lsblk `tran` `sata`/`nvme` map
  straight through (hint only); `sas`/`usb` stay `unknown` since the drive behind may be
  SATA. smartctl's `unknown` media/interface is not written, so an lsblk hint survives.
- `interfaceLabel` with an unknown interface falls back to the link label, else null.
- `recordingTechInferred` lives in `hardware`; smartctl replaces `hardware` wholesale on
  each observation and `refreshRecordingTech` re-adds the flag straight after. T3's
  `specMismatch` will need the same treatment (or merge rather than replace).
- drizzle-kit 0.31 needs a TTY for the rename prompt. Generated with `transport` still in
  the schema, then prepended ``ALTER TABLE `Disk` RENAME COLUMN `transport` TO `link` ``
  to the SQL and renamed the key in `0008_snapshot.json`; a second `generate` reports no
  changes. `vendor` was added to the same migration by hand after it had been applied to
  `dev.db`, so `dev.db` got a manual `ALTER TABLE Disk ADD vendor text`.
- Inventory gate: `media` / `vendors` props on field entries, `isFieldVisible(field,
  { media, vendor })`. Hidden fields keep their stored value.
- Scrutiny importer sets `media` from rotation rate on created disks.
- `test/api/host.e2e.test.ts` "does not serve ../package.json" times out; unrelated,
  pre-existing in this tree.

## Decisions (2026-09-29)

1. Columns for `media`, `interface`, `recordingTech`, block sizes, `trimSupported`; JSON
   `hardware` and `specs` for the rest.
2. `transport` renamed `link` in the same migration.
3. Backblaze fields kept in the snapshot, with attribution.
4. This task precedes 031: dataset `line` is the product line; 031's table keys warranty
   years by that string.
5. Missing models live in a local `overrides.json`; upstream contribution later.

## Unanswered questions

None.
