---
type: task
status: todo
---

# Disk page redesign

`/disks/:id` is the most important page in the app and has grown by accretion since
[014](014-Phase-6-disk-page-and-inventory-UI.md): six stacked sections, three styles
of fact grid, actions in three places, an inventory form that reflows, and two lists
(diary, SMART) with no cap. Reviewed 2026-10-04 against the demo and the author's
real fleet; this doc is the redesign. The sibling
[067 Editable inventory list](067-Editable-inventory-list.md) covers filling fields
across many disks and reuses the field editor built here.

## Why

- **Metadata is hard to parse.** The nameplate is an 11-cell grid mixing identity
  (firmware, sectors), placement (host, device, first/last seen) and live health
  (temperature, power-on). Tiny labels over values in five columns give no row to
  scan. Specs is a second grid in the same style with hardware facts (cache, helium,
  class) that belong beside media and interface.
- **Actions are unorganised.** Simulate fault and Download diagnostics top right;
  state select, Dispose… and the lifecycle badge in a second cluster under the SMART
  badge; Save at the bottom of the form. It is not obvious which controls change
  anything.
- **The form is messy.** Fields in registry order in a three-column grid; Replaces
  and Recording appear and vanish, shifting everything; the warranty suggestion lives
  in the label row and breaks alignment; the 3.3 V switch cannot express "not taped"
  as distinct from "not recorded" once touched. One Save button, easy to forget,
  no leave guard.
- **Spec and metadata repeat.** Media line in the nameplate (`HDD · 5400 rpm · CMR ·
  helium`) and Specs (Helium, Class, Line) say the same things twice.
- **Unbounded sections.** Diary and SMART attribute history can run to screens.
- **Missing data the server already has:** SMART counters (reallocated, pending,
  uncorrectable, wear, written) and fault counts from
  [050](050-Disk-list-columns-and-views.md), WWN (in `keys`), form factor, TRIM,
  link speed, last reading time, price per TB.

Decided 2026-10-04:

- Tabs: Overview, SMART, Diary, under a fixed header. Nothing unbounded on Overview.
- Inventory is edited inline per field, saving on commit. No Save button except Notes.
- Specs merges into a Hardware group. ZFS membership moves into the header strip.
- One actions menu. Simulate fault stays its own button (dev and demo only).
- Add the data the API already carries; warranty links stay in
  [031](031-Vendor-detection-and-vendor-specific-inventory-fields.md), bays in
  [061](061-Physical-bay-mapping.md), open fault rows in a follow-up.

## Header

Fixed above the tabs, follows `pages/hosts/[id].vue`.

- Row 1: back link to `/disks` (left). Right: `SimulateFaultMenu` when the simulator
  is on, then a `⋯` `UDropdownMenu` (`i-lucide-ellipsis`, aria-label "Disk actions"):
  Download diagnostics (`i-lucide-file-archive`, the serials/hostnames warning as the
  item description), then Dispose… (`i-lucide-package-x`) or, when disposed, Edit
  disposal… and Undo disposal. The disposal banner keeps its own buttons; the menu is
  the discoverable copy.
- Row 2: `h1` alias, inline editable (see §Inline fields); `unnamed` dimmed italic when
  blank. Beneath: `MediaGlyph`, `displayModel`, serial in mono, `Replaces K2` line as
  today. BPID joins this line when [031](031-Vendor-detection-and-vendor-specific-inventory-fields.md) lands.
- Row 3, status strip, wrapping chips in this order:
  1. SMART status badge (`DEVICE_STATUS_VOCABULARY`), links to the SMART tab.
  2. Lifecycle badge as a `UDropdownMenu` trigger (`LifecycleBadge` with a trailing
     chevron): items `Automatic (<inferredState>)` and each `STATE_OVERRIDES` entry,
     current one checked. Replaces the ghost `USelect`. Disabled with the existing
     tooltip when disposed. Saves on pick as today. `inferred <state>` dimmed text
     stays when overridden.
  3. Usage text (`usageDetail`) and the purpose badge, as `DiskStateControl` shows now.
  4. Pool breadcrumb when in a pool: `tank › mirror-0 › K1` with `VdevTypeIcon`, the
     ZFS state badge and the archived badge, from `DiskZfsMembership`. The ZFS section
     is deleted; `Not a member of any pool` is not shown (usage already says `empty`).
  5. Faults: `faultCounts` badges in `AppNavCounts` style (open error, open warning,
     acknowledged), linking to `/faults?subject=disk:<id>`. Hidden when all zero.
- Disposal banner between the header and the tabs, unchanged.

`DiskNameplate` becomes the header component; `DiskStateControl` shrinks to the
lifecycle menu; `DiskZfsMembership` becomes the breadcrumb chip.

## Tabs

`UTabs` `variant="link"` as hosts and pools. Active tab in `route.query.tab`
(`overview` omitted, `smart`, `diary`), `router.replace`, so fault rows can link
straight to SMART: `faultSubjectPath` for a disk subject with a SMART category
appends `?tab=smart`. Badges: SMART tab shows the device-status dot
(`TopologyStatusDot`) when not `passed`; Diary tab shows the entry count.

SMART and Diary data load on first activation (`useFetch` with `immediate: false`,
as `/zfs/:id` loads datasets), so Overview renders from `GET /api/disks/:id` alone.
`DiskDetail` drops `diary`; the Diary tab fetches `/api/diary?subjectType=disk&subjectId=:id`
as the hosts page does.

### Overview

Five fact groups and Notes. A group is a heading (`h3`, `text-muted text-sm
font-medium`) over a `dl` of label/value rows: `grid-cols-[8rem_minmax(0,1fr)]`,
label `text-dimmed`, value `tabular`. Rows read left to right, scan top to bottom.
Groups sit in a `grid gap-x-10 gap-y-8 lg:grid-cols-2`: Identity and Hardware on the
first row, Placement and Health on the second, Ownership full width, Notes full width.
Rows whose value is null are hidden except the rows marked always below (shown `—`
dimmed). Inline-editable rows are marked edit.

**Identity**

- Model (full `displayModel`, vendor name before it when detected) always
- Serial always
- WWN from `keys` kind `wwn`, mono
- Firmware mono
- Display model edit (`inventory.modelShort`); display mode shows the resolved
  `modelShort` dimmed when it is a fallback, with a `title` saying where it came
  from (`from spec line` / `from model`). This is what topology tiles print.

**Hardware**

- Capacity always
- Media: `HDD · 5400 rpm` / `SSD` / `unknown`, plus `helium` from specs
- Recording edit (HDD only): `CMR` / `SMR`, `inferred` dimmed when
  `hardware.recordingTechInferred` and no override; enum editor over
  `RECORDING_TECH_OVERRIDES` with `—` to clear the override
- Interface always: `interfaceLabel` plus link speed, `text-error` when below max as today
- Form factor
- Sectors
- TRIM (SSD only): yes / no
- Then the dataset rows from `DiskSpecs` in its order (Line, Class, Cache, TLER/ERC,
  NAND, DRAM, PLP, TBW, DWPD, Sustained write, AFR, In production, Also sold as),
  Helium folded into Media. The source footer and `specMismatch` notes close the
  group, `text-dimmed text-xs`. No spec match: one dimmed row `Specs · none for
  <bareModel>`.

**Placement**

- Host, link, always
- Device path mono, dimmed with `title="last known"` when `!present`
- Pool: the same breadcrumb as the header strip without the state badge (repeats on
  purpose: the strip is glanceable, the group is the record). Hidden when not a member.
- Usage: `usageDetail` always
- Purpose edit: enum over `PURPOSES`; display shows the badge and `inferred from
  mount at /` dimmed when `purposeInferred`
- First seen, Last seen, Last reading (`latestReadingAt`, relative with absolute
  `title`)

**Health**

- SMART: status badge and `read <date>` when a reading exists, always
- Temperature, coloured by `temperatureColour`, always
- Power-on, Power cycles
- Reallocated, Pending, Uncorrectable, Wear, Written: `counters` via
  `InventoryStatusCounter`; HDD hides Wear, SSD hides Pending as the list does; each
  row links to the SMART tab
- Faults: the count badges from the strip, or hidden

**Ownership** (all edit, order fixed, hidden fields never shift the others)

- Purchased: date; hint `5.7 y old` after the value
- Price: money with currency symbol; hint `£23.75/TB` via `moneyPerTb`
- Supplier: text
- Condition: enum
- Warranty: date; hint `2.1 y left` / `expired 4.5 y ago` (amber under
  `WARRANTY_WARNING_DAYS`, dimmed when expired). When blank and a suggestion exists,
  the display shows `3 y from purchase → 2024-01-10 (Red Plus default)` dimmed with
  an Apply link; when blank and the replaced RMA disk has a warranty, `Copy from K2`.
  Suggestion text lives in the value cell, never the label row.
- 3.3 V pin: three-state enum editor `—` / `taped` / `not taped` backed by the
  boolean (`null` / `true` / `false`); the switch goes. Display `taped` / `not
  taped` / dimmed `not recorded`.
- Replaces: disk picker, only when `replacementCandidates` is non-empty, last row
- Vendor-specific fields (BPID) append here when 031 lands

Ownership is generated from `INVENTORY_FIELDS`; `purpose`, `modelShort` and
`recordingTech` are placed by key into the groups above, the rest render in
registry order here. A field's group becomes a registry property (`group:
"identity" | "hardware" | "placement" | "ownership"`, default ownership).

**Notes**

Rendered `DiaryMarkdown`; `Edit` ghost button in the heading swaps in a `UTextarea`
with Save / Cancel. Explicit save because it is long text. Dimmed `No notes` with
the same Edit button when blank.

### SMART

`DiskSmart` as today minus its `h2`: status line, imported-from-scrutiny note, range
tabs (right of the status line), temperature chart, attribute table, self-tests.
Self-tests show the latest 10 with `Show all (n)`. The attribute table's show-all
preference is unchanged.

### Diary

- `Add entry` button (`i-lucide-plus`) in the tab's first row opens the existing
  `DiaryEntryForm` inline above the timeline; closes on save or Cancel. The form is
  not shown by default.
- Filter chips: All / Manual / Auto (`UTabs` pill, client-side on `kind`).
- `DiaryTimeline` over the first 20 entries; `Show older` fetches again with
  `limit` grown by 50 until the response is shorter than the limit. `GET /api/diary`
  already takes `limit`; no cursor needed at home scale.

## Inline fields

One component, `InlineField.vue` (`app/components/inline/`), used by the Ownership
group, the header alias, Display model, Recording, Purpose, and by
[067](067-Editable-inventory-list.md) in a compact variant.

- Props: `{ type: InventoryFieldType | "alias", value, items?, placeholder?,
  format?: (value) => string, hint?: string, saving?: boolean, error?: string | null,
  compact?: boolean }`. Emits `commit(value)`.
- Display mode: a `button` (keyboard focusable) showing the formatted value or
  dimmed placeholder (`—`), with `i-lucide-pencil` at `opacity-0
  group-hover:opacity-100 focus-visible:opacity-100`. Enter, Space or click enters
  edit mode.
- Edit mode: `UInput` (text, date, number with currency leading), `USelect` (enum,
  opens immediately), `UInputMenu` for the Replaces picker. Enter or blur commits;
  Escape reverts; a select commits on pick. Commit emits only when the value
  changed.
- Saving: spinner replaces the pencil; success shows `i-lucide-check` for a second
  then returns to display. No success toast.
- Error: the control stays open with the message beneath (`text-error text-xs`);
  toast only for network failures. Alias validation messages come from the 400
  body.
- Each commit is one `PATCH /api/disks/:id` with only that key: `{ alias }`,
  `{ notes }`, `{ inventory: { [key]: value } }` or `{ replacesDiskId }`.
  `mergeInventory` already merges, and `null` clears a key. The response replaces
  `disk` on the page as `onUpdated` does today, so hints (age, warranty left)
  update.
- Date: native `type="date"` as today; typed value commits on blur, the picker on
  change.
- Money: `currencyStep` and symbol as today; blank commits `null`.

`DiskInventoryForm`, `inventoryDraft.ts` and their tests go; `warrantySuggestion`
moves to `shared/warranty.ts` (it is pure and 067 needs it).

## Mobile

- Header rows wrap; the status strip scrolls horizontally if it must.
- Groups single column; `dl` label column shrinks to `6rem`.
- Tabs scroll horizontally (Nuxt UI default).
- Inline fields: the pencil is always visible below `md` (no hover).

## Order

1. `InlineField` with tests; `warrantySuggestion` to `shared/`; field `group` in
   the registry.
2. Header: nameplate rows, actions menu, lifecycle menu, pool breadcrumb, fault
   badges. Delete the ZFS section.
3. Tabs with `?tab=`; `DiskDetail` loses `diary`; Diary tab fetch, Add entry
   toggle, kind filter, Show older; SMART lazy load; self-test cap;
   `faultSubjectPath` deep link.
4. Overview groups; Specs folded into Hardware; Ownership from the registry; Notes
   edit; delete `DiskInventoryForm`, `DiskSpecs`.
5. 003 §UI disk page paragraph; 037 if the lifecycle menu needs an entry; screenshots
   in the README if any show the old page.

## Tests

- `InlineField`: display → edit on click and Enter; Escape reverts without emit;
  unchanged value does not emit; blur commits; error keeps the control open with
  the message; compact variant renders no label.
- Page (`app/pages/disks/id.test.ts`): header strip shows status, lifecycle menu,
  usage, breadcrumb, fault badges; `?tab=smart` opens SMART; Overview renders the
  five groups with null rows hidden and always-rows `—`; editing Purchased sends
  `{ inventory: { purchaseDate } }` only and the age hint updates from the
  response; 3.3 V `not taped` sends `false`, `—` sends `null`; Notes Edit → Save
  sends `{ notes }`; Diary tab fetches `/api/diary` lazily, Show older grows
  `limit`, kind chips filter; disposed disk disables the lifecycle menu and the
  actions menu shows Edit / Undo disposal.
- `DiskNameplate` and `DiskStateControl` tests rewritten for the header; `DiskSpecs`
  rows tests move to the Hardware group; `DiskInventoryForm` tests retired, their
  warranty suggestion cases move to `shared/warranty.test.ts`.
- `faultSubjectPath`: SMART-category disk fault → `/disks/3?tab=smart`; other disk
  faults → `/disks/3`.
- e2e `GET /api/disks/:id` no longer carries `diary`; `GET /api/diary?subjectType=
  disk&subjectId=&limit=` honours the limit.

## Out of scope

- Prev/next disk navigation on the page.
- Open fault rows on the page (counts and the link only); a follow-up once the
  faults list has a compact row component.
- Warranty check links (031), bays (061), identify light (064).
- Attribute chart for a selected attribute (014 contract, never built).
