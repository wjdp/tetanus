---
type: task
status: todo
---

# Disk list columns and views

The disks list has 18 columns and 10 filter selects. At desktop width the table
overflows and the filter row wraps; columns hide at fixed breakpoints
(`COLUMN_META`, `InventoryTable.vue`), so the user cannot see vendor or 3.3 V on
a laptop at all. Mobile collapses to cards with a fixed field set.

Goals: user-chosen table columns, user-chosen table or cards view (cards forced
below `md`), filters that read at a glance and live in the URL, more columns
including SMART health counters, and the 3.3 V bug fixed.

Depends on [051](051-Currency-setting.md) for the Price and price-per-TB columns.

## 3.3 V column shows 0

Bug. `SORT_FIELDS` `pin33` returns `0` when not taped. The `#pin33-cell` slot
renders only `v-if` taped, so its content is a lone comment node; Vue treats an
all-comment slot as empty and renders the slot's fallback, which in Nuxt UI's
`Table.vue` is `FlexRender` of the accessor value: `0`.

Same bug today in `#recording-cell` (`UBadge v-if`): an unknown recording renders
the raw accessor string.

- `pin33` value: `true → 1`, else `null` (sorts last via `sortUndefined`).
- Cell renders `—` dimmed when not taped, matching other empty cells. Never leave a
  cell slot able to render only a comment; the column registry below makes this
  structural.

## Column registry

Replace `SORT_FIELDS` with `INVENTORY_COLUMNS` (`app/components/inventory/columns.ts`):

```ts
{ id, label, group, value, defaultVisible, locked? }
```

- `value` keeps today's sort role (`sortDisks` for cards, `accessorFn` for table).
- One renderer, `InventoryCell.vue` (`{ column, disk }`), switches on id; table
  columns use `cell: ({ row }) => h(InventoryCell, …)` instead of 18 named slots.
  Cards reuse it for their fixed fields, removing today's duplicated cell markup.
- `alias` is `locked` (always shown, not in the picker).
- Drop `COLUMN_META` breakpoint hiding: a column the user turned on must show.
  Table scrolls horizontally when wide (UTable already `overflow-auto`).

Defaults (visible): alias, model, capacity, media, host, pool, state, status,
temp, power-on, warranty. Off by default: vendor, interface, recording, sectors,
usage, age, 3.3 V, plus every new column below. Usage is mostly the pool name
again for ZFS disks, hence off.

## Column picker

- `UDropdownMenu` with `type: "checkbox"` items (Nuxt UI's documented column
  visibility pattern), trigger `UButton` `i-lucide-columns-3` "Columns", sits right
  of the filters. Items in registry order, grouped: Identity, Hardware, Placement,
  Health, Inventory. Footer item "Reset to default".
- Checkbox items need `onSelect: (e) => e.preventDefault()` beside
  `onUpdateChecked`, or the menu closes on every toggle (Nuxt UI's example does
  this).
- Replaces the "Sectors column" checkbox and the `showSectors` model chain (page →
  filters → table).
- Table only. Hidden in cards view and below `md`.
- Column order fixed by registry; drag reordering out of scope.

## Table or cards

- `view: "table" | "cards"`, default `table`. Toggle: `UFieldGroup` of two icon
  buttons, `i-lucide-table-2` / `i-lucide-layout-grid`, next to Columns, `hidden md:flex`.
- Below `md` always cards, no JS breakpoint: table `v-if="view === 'table'"` +
  `hidden md:block`; cards `md:hidden` when table, no class when cards. `v-if` on
  cookie state is SSR-safe and skips rendering a hidden wide table.
- Cards on desktop: grid `md:grid-cols-2 xl:grid-cols-3`.
- Cards keep today's fixed field set, unaffected by the column picker.
- Cards keep their own sort select (table sorts by header). Both share `sorting`;
  the sort select offers every column, visible or not.

## Preferences

`useInventoryPreferences()` composable over `useCookie("inventory.prefs")`:
`{ columns, view }`. Cookie, not localStorage, so SSR renders the right columns
and view first time with no reflow.

- Store only overrides `{ [id]: boolean }`, not the visible list, so a column added
  later appears per its `defaultVisible`. Unknown ids dropped on read.
- Validate with a zod schema in the composable; bad cookie → defaults.
- `sameSite: "lax"`, explicit long `maxAge` (Nuxt default is a session cookie),
  `default: () => ({})`; not `httpOnly` (client writes it).

## URL state

Filters and sort live in the query string: back button restores them, links are
shareable, reload keeps them. Columns and view stay in the cookie (preference, not
state).

- `useInventoryQuery()` maps `InventoryFilterState` + `SortingState` ↔ `route.query`.
  Keys: `q`, `host`, `pool`, `usage`, `purpose`, `media`, `interface`, `recording`,
  `vendor`, `state` and `status` (comma lists), `sort` (`temp` asc, `-temp` desc).
- Defaults omitted, so the bare `/disks` is the cleared state. `ALL_*` / `NO_*`
  sentinels (`*`, `-`) encode as absent / `none`.
- Unknown or invalid values ignored on read (zod), not errors.
- Select changes `router.push`; search `router.replace`, debounced, so typing does
  not flood history.
- SSR reads the query, so filtered pages render filtered.
- Sidebar Disks link stays bare `/disks`.

## Filters

037 grammar applies: icon = kind, colour = severity only, icons never coloured
for status.

- Every select gets a leading icon for its category when "All", and the selected
  item's icon when set:
  - Host `i-lucide-server`, Pool `i-lucide-database` (037 entity icons).
  - State: `LIFECYCLE_VOCABULARY` icon per item, `i-lucide-tags` when all.
  - Media: `MediaGlyph` per item via `#item-leading` / `#leading` slots (platter
    is a component, not an icon name).
  - Interface `i-lucide-cable`; Recording `i-lucide-disc-3`; Usage
    `i-lucide-pie-chart`; Purpose `i-lucide-bookmark`; Vendor `i-lucide-factory`
    (no vendor logos: brand marks).
- Active filter (not "All") gets `color="primary" variant="soft"` so set filters
  stand out from idle ones. Primary is not a status colour.
- New: SMART status filter (missing today), items with `TopologyStatusDot`
  per `DEVICE_STATUS_VOCABULARY`, the one place colour is legitimate here.
  Multi-select like State.
- Item counts: each option shows how many disks match it given the other filters
  (`mars · 24`), trailing, `text-dimmed`. Computed from `allDisks` filtered by
  every filter except that select's own. Hides dead options without removing them.
- Space: inline keep Search, Host, Pool, State, Status; move Usage, Purpose,
  Media, Interface, Recording, Vendor into a "Filters" `UPopover` button with a
  count badge of how many of those are set. Clear stays inline.

## New columns

### Client only

`DiskSummary` already carries the field; `InventoryDisk` grows to match.

| id | label | source | group |
| --- | --- | --- | --- |
| `serial` | Serial | `serial` (own column; Model drops its second line when Serial shown) | Identity |
| `firmware` | Firmware | `firmware` | Identity |
| `device` | Device | `lastDevicePath` (`/dev/sdc`), for finding the disk on the box; dimmed when `!present` (stale path) | Placement |
| `vdev` | Vdev | `membership.groupName ?? vdevName`, vdev type icon | Placement |
| `vdevState` | ZFS state | `membership.vdevState`, `zfsStateColour` | Health |
| `powerCycles` | Power cycles | `latestPowerCycles` | Health |
| `lastReading` | Last reading | `latestReadingAt`, relative | Health |
| `firstSeen` | First seen | `firstSeenAt` | Identity |
| `formFactor` | Form factor | `formFactor` | Hardware |
| `trim` | TRIM | `trimSupported` | Hardware |
| `purchased` | Purchased | `inventory.purchaseDate` | Inventory |
| `price` | Price | `inventory.purchasePrice`, `formatMoney` (051) | Inventory |
| `pricePerTb` | {symbol}/TB | price ÷ capacity, `formatMoneyPerTb` (051) | Inventory |
| `supplier` | Supplier | `inventory.supplier` | Inventory |
| `condition` | Condition | `inventory.purchaseCondition` | Inventory |
| `notes` | Notes | `notes` (markdown) stripped to plain text, truncated, full in `title` | Inventory |

### Server side

The most useful health columns. Not in `listDisks` today.

| id | label | source | colour |
| --- | --- | --- | --- |
| `faults` | Faults | live faults with `subjectType = disk`, one badge per bucket | open `error` red solid, open `warning` amber solid, acknowledged amber subtle (037: acknowledged any severity → `warning`); zero buckets hidden, none → `—` |
| `reallocated` | Reallocated | ATA `5`; SCSI `scsi_grown_defect_list` | attribute display status |
| `pending` | Pending | ATA `197` | attribute display status |
| `uncorrectable` | Uncorrectable | ATA `198`; NVMe `media_errors`; SCSI `read_total_uncorrected_errors` + `write_total_uncorrected_errors` (colour worst of the two) | attribute display status |
| `wear` | Wear | NVMe `percentage_used`; ATA SSD `100 − value` (normalised) of the life attribute, chosen by name (below) | NVMe: attribute status (already `failed` at 100) plus `warning` ≥ 80 %; ATA: `warning` ≥ 80 %, `error` ≥ 100 % (no metadata threshold) |
| `written` | Written | NVMe `data_units_written × 512 000` bytes; ATA `241` × unit (below) | none |

#### Query at read time, no denormalised counters

`SmartAttribute.status` holds only `passed | warning | failed`; `accepted` and
`acknowledged` are overlaid at read time from `FaultAcceptance` (`overlayStatus`,
`shared/smart/status.ts`). Acceptance, `reapplySmartPolicy` (rewrites the latest
reading's `transformedValue` / `status`) and the scrutiny importer all change
what the column should show without an ingest, so a denormalised counter column
would go stale.

- `listDisks`: one query over `SmartAttribute` for each disk's latest reading
  (`readingId IN (SELECT max(id) … GROUP BY diskId)`), filtered to the counter
  attrIds plus each disk's `ataSsdAttributes` ids; one query over active
  `FaultAcceptance`; `overlayStatus` in the service. Tens of disks × a dozen rows.
- 5 / 197 / 198 / NVMe / SCSI counts use `transformedValue` (agrees with the
  disk page); wear uses normalised `value`.
- Extraction in pure `shared/smart/counters.ts` (`countersFrom(protocol, rows,
  ataSsdAttributes)`), unit tested against `test/fixtures/` SMART output.
- `DiskSummary.counters: { reallocated, pending, uncorrectable, wearPercent,
  bytesWritten, bytesWrittenInferred }`, each with display status where coloured.

#### ATA SSD wear and written: by smartctl name

Vendors reuse ATA ids: on `test/fixtures/mars/smartctl/xall-sdn-auto.json`
(Intel SSDSC2KG480G8R) 233 is `Total_LBAs_Written` and 202 `End_of_Life`, not
wear. Stored `SmartAttribute.name` for ATA is the metadata display name, not
smartctl's, so matching must happen on the parsed reading at ingest.

- New `Disk.ataSsdAttributes` json, written at ingest when `media === "ssd"` and
  the reading is latest (`isLatest`, `recordSmartReading`):
  `{ wear: attrId | null, written: { attrId, unitBytes, inferred } | null }`.
  An identifier, not a value: stable per model, never stale under acceptance or
  policy re-apply.
- Wear: first present of `ATA_LIFE_REMAINING_ATTRIBUTES` in set order
  (`Wear_Leveling_Count`, `Media_Wearout_Indicator`, `Percent_Life_Remaining`,
  `SSD_Life_Left`, `Percent_Lifetime_Remain`). Move the set from
  `server/services/simulator/smartctl.ts` to `shared/smart/` and share it.
- Written, `shared/smart/writtenBytes.ts`: unit from name suffix (`_32MiB`, `_GiB`,
  `_GB`, `_MiB`); else vendor rule (`intel` `Total_LBAs_Written` → 32 MiB, per the
  sdn fixture: 1 327 539 → ~44 TB); else LBAs × `logicalBlockSize`,
  `inferred: true`, shown `~` prefixed with a `title`.
- Migration adds the column null; filled on next ingest; one-off boot backfill
  re-parsing `Disk.latestRaw`, gated by a settings flag like
  `faultsBackfilledAt`. Scrutiny imports do not set it: those disks show `—`
  until a collector reading.
- Amend 003's data-model sketch with the new column.

#### Faults

- One `GROUP BY subjectId, state, severity` over `LIVE_FAULT_STATES` in
  `listDisks` → `faultCounts: { error, warning, acknowledged }`. Not denormalised.
- Badges reuse `AppNavCounts` styling (048), plus the acknowledged bucket the
  sidebar omits. Matches the Faults page `Live` chip (open + acknowledged).
- Sort by open errors, then open warnings, then acknowledged.

Sort for all: numeric, nulls last. HDDs have no wear; SSDs no pending: `—`.

## Build

1. 3.3 V fix + test (standalone, ship first).
2. `columns.ts` registry + `InventoryCell.vue`; table and cards render through it.
   No behaviour change except breakpoint hiding gone.
3. `useInventoryPreferences` + column picker; remove `showSectors`.
4. View toggle + desktop card grid.
5. `useInventoryQuery`: filters and sort in the URL.
6. Filters: icons, active colour, status filter, counts, popover.
7. Client-only columns (price columns after 051).
8. Server columns: `countersFrom` + `writtenBytes`, `ataSsdAttributes` migration,
   ingest write, backfill, latest-reading query and `faultCounts` in `listDisks`,
   columns, 003 amendment.

## Tests

- `columns`: `pin33` null when not taped; unique ids; locked columns not hideable.
- `InventoryTable`: not-taped row renders `—`, never `0`; unknown recording renders
  `—`; hidden column absent.
- `InventoryCards`: field set unaffected by column prefs.
- `useInventoryPreferences`: defaults; overrides merge; unknown ids dropped; bad
  cookie → defaults; new `defaultVisible` column appears with old cookie.
- `useInventoryQuery`: round trip every filter and sort; defaults omitted;
  invalid values ignored; search uses replace, selects push.
- Page (`app/pages/disks/index.test.ts`): replace the `show-sectors` test with a
  picker test; view toggle swaps table/cards; status filter filters; query string
  pre-filters on load.
- Filters: active select carries primary; counts reflect other filters.
- `countersFrom`: ATA, NVMe and SCSI fixtures; missing attributes → null;
  accepted / acknowledged overlay applied; SCSI worst-of-two status.
- `ataSsdAttributes` from parsed readings: Intel sdn picks no 233 wear, 32 MiB
  written; Samsung `Wear_Leveling_Count`; name-suffix units; inferred fallback;
  HDD → null.
- Ingest writes `ataSsdAttributes` only for the latest reading; backfill from
  `latestRaw` runs once.
- After `reapplySmartPolicy` and after accepting a fault, `listDisks` counters
  reflect the change without an ingest.
- `listDisks`: `faultCounts` per disk; open split by severity; acknowledged
  bucket; accepted/resolved excluded.
- e2e `GET /api/disks` carries `latestCounters` and fault counts.



## As built: server columns

Server half of build step 8. UI columns not yet built.

- `DiskSummary.counters: DiskCounters` and `faultCounts: DiskFaultCounts`, also on
  `getDisk` (shared `summarise`). `ataSsdAttributes` rides along from the row.
  ```ts
  interface StatusCounter { value: number; status: AttributeDisplayStatus }
  interface DiskCounters {
    reallocated: StatusCounter | null;
    pending: StatusCounter | null;
    uncorrectable: StatusCounter | null;
    wearPercent: StatusCounter | null;
    bytesWritten: number | null;
    bytesWrittenInferred: boolean;
  }
  interface DiskFaultCounts { error: number; warning: number; acknowledged: number }
  ```
- Latest reading is the newest `takenAt` (id breaks ties), a correlated subquery per
  disk on `SmartReading_diskId_takenAt_idx`, not `max(id)`: scrutiny imports insert
  older readings after newer ones. Agrees with `latestReading`.
- `countersFrom(rows, ataSsdAttributes, acceptances)`: no protocol argument, the
  counter ids are disjoint across protocols, so disks with no known protocol still
  get counters; acceptances passed in to keep it pure.
- Colour uses `AttributeDisplayStatus`, so "error" is `failed`. Worst-of ranks
  `passed < accepted < acknowledged < warning < failed`.
- Wear: ≥ 80 % `warning`, ≥ 100 % `failed` for both protocols. NVMe takes the worse
  of that and the attribute's status, unless the attribute is accepted or
  acknowledged, which stands. ATA wear has thresholds only, no overlay, clamped at 0.
- Written: ATA attribute `241` only, unit from its smartctl name; Intel's duplicate
  `233 Total_LBAs_Written` is ignored. No block size → 512, inferred.
- Ingest writes `ataSsdAttributes` on every latest reading, `null` when not a SATA
  SSD, so a reclassified disk does not keep stale ids.
- Backfill `backfillAtaSsdAttributesOnce` runs synchronously in the migrate plugin
  after `applySmartPolicyIfStale` (parsing tens of `latestRaw` is quick), gated by
  `config.ataSsdAttributesBackfilledAt`; not a queued task.
- e2e asserts `counters`, not `latestCounters`.
