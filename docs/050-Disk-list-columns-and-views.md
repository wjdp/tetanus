---
type: task
status: todo
---

# Disk list columns and views

The disks list has 18 columns and 10 filter selects. At desktop width the table
overflows and the filter row wraps; columns hide at fixed breakpoints
(`COLUMN_META`, `InventoryTable.vue`), so the user cannot see vendor or 3.3 V on
a laptop at all. Mobile collapses to cards with a fixed field set.

Goals: user-chosen columns, user-chosen table or cards view (cards forced below
`md`), filters that read at a glance, and the 3.3 V bug fixed.

## 3.3 V column shows 0

Bug. `SORT_FIELDS` `pin33` returns `0` when not taped. The `#pin33-cell` slot
renders only `v-if` taped, so its content is a lone comment node; Vue treats an
all-comment slot as empty and renders the slot's fallback, which in Nuxt UI's
`Table.vue` is `FlexRender` of the accessor value: `0`.

- `pin33` value: `true → 1`, else `null` (sorts last via `sortUndefined`).
- Cell renders `—` dimmed when not taped, matching other empty cells. Never leave a
  cell slot able to render only a comment; the column registry below makes this
  structural.

## Column registry

Replace `SORT_FIELDS` with `INVENTORY_COLUMNS` (`app/components/inventory/columns.ts`):

```ts
{ id, label, value, defaultVisible, locked?, sortable? }
```

- `value` keeps today's sort role (`sortDisks` for cards, `accessorFn` for table).
- One renderer, `InventoryCell.vue` (`{ column, disk }`), switches on id; table
  columns use `cell: ({ row }) => h(InventoryCell, …)` instead of 18 named slots, and
  cards reuse it. Today's table slots and card `dl` duplicate every cell.
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
- Replaces the "Sectors column" checkbox and the `showSectors` model chain (page →
  filters → table).
- Applies to both views; visible on mobile too since it drives cards.
- Column order fixed by registry; drag reordering out of scope.

## Table or cards

- `view: "table" | "cards"`, default `table`. Toggle: `UFieldGroup` of two icon
  buttons, `i-lucide-table-2` / `i-lucide-layout-grid`, next to Columns, `hidden md:flex`.
- Below `md` always cards, CSS only (no JS breakpoint, no SSR mismatch): table gets
  `hidden md:block` only when `view === "table"`; cards get `md:hidden` when table,
  nothing when cards.
- Cards on desktop: grid `md:grid-cols-2 xl:grid-cols-3`.
- Card header stays fixed: alias, model, serial, SMART status, lifecycle badge.
  The `dl` renders the visible columns minus the header ones, through
  `InventoryCell`. So hiding Warranty hides it in cards too.
- Cards keep their own sort select (table sorts by header). Both share `sorting`
  already.

## Persistence

`useInventoryPreferences()` composable: `{ columns, view }`.

- Store only overrides `{ [id]: boolean }`, not the visible list, so a column added
  later appears per its `defaultVisible`. Unknown ids dropped on read.
- Recommend `useCookie("inventory.prefs")` over the `localStorage` + `onMounted`
  pattern in `DiskRail` / `DiskAttributeTable`: SSR renders the right columns and
  view first time; localStorage would flash the default table then reflow it.
  Validate with a zod schema in the composable; bad cookie → defaults.

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
  per `DEVICE_STATUS_VOCABULARY` — the one place colour is legitimate here.
  Multi-select like State.
- Item counts: each option shows how many disks match it given the other filters
  (`mars · 24`), trailing, `text-dimmed`. Hides dead options without removing them.
- Space: inline keep Search, Host, Pool, State, Status; move Usage, Purpose,
  Media, Interface, Recording, Vendor into a "Filters" `UPopover` button with a
  count badge of how many of those are set. Clear stays inline.

## New columns

From `/api/disks` as is (`DiskSummary` already carries the field):

| id | label | source | group |
| --- | --- | --- | --- |
| `serial` | Serial | `serial` (own column; Model then drops its second line when Serial shown) | Identity |
| `firmware` | Firmware | `firmware` | Identity |
| `device` | Device | `lastDevicePath` (`/dev/sdc`) — finding the disk on the box | Placement |
| `vdev` | Vdev | `membership.groupName ?? vdevName`, vdev type icon | Placement |
| `vdevState` | ZFS state | `membership.vdevState`, `zfsStateColour` | Health |
| `powerCycles` | Power cycles | `latestPowerCycles` | Health |
| `lastReading` | Last reading | `latestReadingAt`, relative; stale per host freshness | Health |
| `firstSeen` | First seen | `firstSeenAt` | Placement |
| `formFactor` | Form factor | `formFactor` | Hardware |
| `trim` | TRIM | `trimSupported` | Hardware |
| `purchased` | Purchased | `inventory.purchaseDate` | Inventory |
| `price` | Price | `inventory.purchasePrice` | Inventory |
| `pricePerTb` | £/TB | price ÷ capacity | Inventory |
| `supplier` | Supplier | `inventory.supplier` | Inventory |
| `condition` | Condition | `inventory.purchaseCondition` | Inventory |
| `notes` | Notes | `notes`, truncated, full in `title` | Inventory |

Need server work, so a follow-up task, not this one: open fault count per disk;
reallocated / pending / uncorrectable sector counts (HDD); SSD wear % and TB
written. These are the most useful health columns, but `listDisks` does not
expose them and they need extraction from the latest reading at ingest.

## Build

1. 3.3 V fix + test (standalone, ship first).
2. `columns.ts` registry + `InventoryCell.vue`; table and cards render through it.
   No behaviour change except breakpoint hiding gone.
3. `useInventoryPreferences` + column picker; remove `showSectors`.
4. View toggle + desktop card grid + cards honouring columns.
5. Filters: icons, active colour, status filter, counts, popover.
6. New client-side columns.

## Tests

- `columns`: `pin33` null when not taped; every column has a unique id; locked
  columns not hideable.
- `InventoryTable`: not-taped row renders `—`, never `0`; hidden column absent.
- `InventoryCards`: hidden column absent from `dl`; header fields always present.
- `useInventoryPreferences`: defaults; overrides merge; unknown ids dropped; bad
  cookie → defaults; new `defaultVisible` column appears with old cookie.
- Page (`app/pages/disks/index.test.ts`): replace the `show-sectors` test with a
  picker test; view toggle swaps table/cards; status filter filters.
- Filters: active select carries primary; counts reflect other filters.

## Questions

- Cookie over localStorage for prefs (SSR-correct, no flash)? Recommended.
- Cards honour the column selection, or keep a fixed card field set?
- Filter popover split (which stay inline) acceptable?
- Sync filters + sort to the URL query (back button, shareable link)? Not in
  scope as written.
- Price shown in £, as the inventory form hard-codes it. Fine?
- Server-side health columns (sector counts, SSD wear, fault count) as task 051?
