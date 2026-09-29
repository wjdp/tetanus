---
type: task
status: in-progress
---

# Home page redesign and status vocabulary rollout

Redesign of the Topology page and rollout of the
[037 status and icon vocabulary](037-Status-and-icon-vocabulary.md) to every page that
shows a status. Decisions taken 2026-09-29 in a review of the home page; 037 is the
contract, this is the work. Two phases: the home page (§Home page, order steps 1 to 5)
ships first; the rollout to the other pages (§Vocabulary rollout, steps 6 and 7) follows.

## Why

The home page is the first thing seen and today it is plain: every tile is alias plus a
dot, only system disks get an icon, the pool bar is the only number, and vdev rows say
nothing about what kind of vdev they are or how full it is. Status colours are decided
per component (`statusColour.ts`, `mediaIcon`, `usageColour`, `TaskState`, each table)
so the same state can look different on two pages.

## Home page

### Host summary strip

Under the host name, one dimmed line of facts before the pools. Kept simple: counts
and sums only, no status roll-up (the tiles and the Faults page do that).

```
mars   14 disks · 12 HDD · 2 SSD · 176 TB raw          zfs 3 min · smart 30 min · snapshots 4 h
```

- Disk count by media, from the disks list (`lastSeenHostId`), in-pool and rail alike.
- Raw capacity: sum of `capacityBytes` over disks on the host.
- Collector freshness chips as today, right-aligned; `ok` chips stay neutral. Active
  scan chips as today.

### Pool card

- Header unchanged except `ONLINE` renders `success`.
- Scan running: thin `info` bar under the capacity bar with `scrub 41 % · 3 h left`.
  Replaces the text-only header note.
- Capacity bar colours per 037 (80 % warning, 90 % error).
- Vdev order: data vdevs first in name order, then the class vdevs (`special`, `log`,
  `cache`, `dedup`, `spares`) after a subtle divider, so they read as the pool's footer.

### Vdev row

Label column becomes: vdev type icon + mono label, state word under it (green when
`ONLINE`), then a mini `UProgress` and `11 TB of 54 TB · 63 %` from the vdev's own
`sizeBytes` / `allocBytes` (already on `VdevNode`, from `zpool list -v`). Single-device
groups (`stripe`, `log`, `cache`) sum their leaves. `frag` only in the tooltip.

### Disk tile

Three lines, `w-36` (9 rem), `h-20`:

```
┌────────────────┐
│ K2   sys    ●  │   alias (semibold), purpose badge if any, status dot
│ Exos X18       │   short model, dimmed, truncated
│ 18 TB · 34°  ◎ │   capacity · temp (tabular), media glyph bottom-right
└────────────────┘
```

- Short model: `modelShort` inventory field when set, else drive-db `line` when the
  spec is known ("Exos X18", "WD Red Plus"), else `bareModel(model)`. Full model,
  serial, interface and vdev path in the tooltip.
- Dot per 037: worst of SMART status and leaf state; hollow when SMART is `unknown`.
- Temperature coloured per 037 thresholds; `—` when unknown.
- Error counters replace line 3 when any is non-zero (as today, `error` mono).
- Non-`ONLINE` leaf state replaces line 2 in the state's colour.
- Unlinked leaf (no disk): dashed border, path basename, no glyph, dimmed "unlinked".
- Hover: `border-accented` and a 1 px lift (`-translate-y-px`), 150 ms.

### Host-local disks

Decided 2026-09-29: a disk physically present on a host renders under that host, not in
the rail. boxy had two `dead` disks plugged in for a pre-RMA check and they sat in the
rail as if nobody could see them.

- **Live** = `present` (seen within `PRESENT_WINDOW_MS`, from `lastSeenAt`) and
  `lastSeenHostId` set. State override is irrelevant: a `dead` disk plugged into boxy is
  live. `listDisks` returns `present: boolean` so the client never re-derives the window.
- Host section order: pools first, then one **Other disks** card (same border and padding
  as a pool card, header "Other disks" with no state badge) holding one vdev-style row per
  group: label column carries the lifecycle icon and label from 037 (`sys` badge group is
  labelled "system"), tiles to the right. Group order: `system`, `spare`, `in-use`
  ("in use, not in a pool"), `dead`, `retired`, `sold`. Tiles are the same `DiskTile`
  fed a `TopologyDisk` (no leaf): dot = `railColour`, no vdev state line, no counters.
- A host with no pools and no live disks keeps "No pools reported yet."; a host with
  live disks and no pools shows only the Other disks card.
- Rail keeps only disks nobody can see: `missing`, `removed`, `unseen`, then the
  `History` disclosure for `dead` / `retired` / `sold` with no live sighting. Empty
  text becomes "Every known disk is attached to a host."
- `groupDisks.ts`: `hostDiskGroups(disks, hostId, inPool)` and `railGroups` filtering
  on `!present`. `index.vue` passes each host its disks.

### Rail

- Row: dot, media glyph, alias, `sys`/`other` badge, short model, capacity, host.
- Group headers gain the lifecycle icon from 037.
- Only non-present disks (§Host-local disks).
- `Dead`, `Retired`, `Sold` collapse into one `History (n)` disclosure, closed by
  default, open state remembered in `localStorage` (`topology.historyOpen`).
- Empty rail text unchanged.

### Data

- `VdevDisk` (pools API) gains `capacityBytes`, `media`, `purpose`, `latestTemp`,
  `modelShort`. The disks list gains `modelShort` too, so the rail and tile share
  `TopologyDisk`. `modelShort` is resolved server-side (`displayName.ts` sibling in
  `shared/model.ts`): inventory override → drive-db `line` → `bareModel`.
- `modelShort` inventory field: one line in `INVENTORY_FIELDS` (`type: "text"`), so
  it appears in the edit form and the importer mapping for free. Not a table column.
- Temperature thresholds: `Host.temperatureThresholds` json column
  (`{ hdd?: { warning, error }, ssd?: { warning, error } }`, zod in
  `shared/schemas/hosts.ts`, added to `hostPatchSchema`). One migration. Hosts
  settings page gets four number inputs per host with the defaults shown as
  placeholders; blank means default. `shared/temperature.ts` holds the defaults and
  `resolveTemperatureThresholds`. The pools and disks APIs return each disk's resolved
  thresholds (`tempThresholds`) so the client never needs the host row.

## Vocabulary rollout

One `app/utils/vocabulary/` module per 037 table; every consumer below imports from
it and the old per-component maps go.

| page / component | change |
| --- | --- |
| `TopologyStatusDot` | `shape` prop, `filled` default |
| `MediaGlyph.vue` (new) | platter from `TetanusMark` geometry, `size` prop; `ssd` renders `i-lucide-microchip` |
| `VdevTypeIcon.vue` (new) | type → icon |
| `LifecycleBadge.vue` (new) | state → icon + label + colour, `outline` when overridden; used by `DiskStateControl`, `InventoryTable`, `InventoryCards`, rail headers |
| `statusColour.ts` | `zfsStateColour(ONLINE)` → `success`; `diskStateColour(dead)` → `neutral`; then folded into vocabulary |
| `usageColour` | `unknown` → `neutral` |
| `DiskNameplate` | SMART badge with dot shape; media glyph beside the model; temp coloured |
| `DiskAttributeTable` / `attributeRows` | accepted rows: hollow amber dot and `i-lucide-shield-check`; trend chips unchanged |
| `DiskZfsMembership` | vdev type icon in the breadcrumb; state badge green when `ONLINE` |
| `VdevTreeTable`, `zfs/index`, `zfs/[id]` | `ONLINE` green, vdev type icons, capacity bar colours |
| `InventoryTable` / `InventoryCards` | media glyph column, lifecycle badge, status dot with shape, temp colour |
| `DiaryTimeline` | event icon per 037 in the gutter |
| `AppFaultBanners`, `Faults` page ([036](036-Faults-page.md)) | already per 037; confirm gutter widths |
| `hosts.vue` | freshness chips per 037 |
| Command palette | entity icons per 037 |

Docs: [008](008-Branding-and-colour.md) §Colour table gets a row pointing at 037 for
per-status rules, and rule 2 gains "ONLINE is the other green".

## Order

1. Vocabulary module, `StatusDot` shape, `MediaGlyph`, `VdevTypeIcon`,
   `LifecycleBadge`, temperature defaults and resolver in `shared/`. Unit tests.
2. Colour changes (`ONLINE`, `dead`, usage `unknown`, capacity thresholds) and their
   tests. Small commit, easy to revert if a colour reads wrong in the app.
3. `Host.temperatureThresholds` migration, hosts patch route and settings inputs;
   `modelShort` inventory field and resolver; pools API and disks list fields.
4. Tile, vdev row, pool card, rail, host strip. Check dark and light, phone width.
5. Host-local disks: Other disks card, rail filter, index wiring.
6. Rollout to the other pages, one commit per row of the table. Later phase.
7. Docs 008 amendment. Later phase.

Steps 1 to 5 are being built by delegated agents from 2026-09-29; `statusColour.ts`
and `mediaIcon` stay as thin wrappers over the vocabulary module until step 6 removes
them, so the other pages keep working untouched.

## Tests

- `vocabulary/*.test.ts`: every enum member has an entry (type-level) and the colour
  rules 037 calls out as changes (`ONLINE` success, `dead` neutral).
- `groupDisks.test.ts`: history grouping, tile colour with hollow shape, vdev usage sums
  for single-device groups, host disk groups and the rail `present` filter.
- `DiskTile.test.ts` (new): three lines, temp colour by media, counters replace line 3,
  unlinked leaf.
- `HostSection.test.ts` (new): summary strip counts and raw capacity; Other disks card
  present, absent, and a pool-less host with live disks.
- `shared/temperature.test.ts`: defaults, per-host override, blank falls back.
- `hosts.e2e`: PATCH thresholds round-trips and validates ranges (warning < error).
- `index.test.ts`: history disclosure closed by default and persisted.
- `MediaGlyph.test.ts`: snapshot of both glyphs at 16 px.
- e2e untouched: no route changes beyond added fields; `pools.e2e` asserts the new
  `VdevDisk` fields.

## Out of scope

- Charts palette (008 rule 5, still deferred).
- Faults page itself ([036](036-Faults-page.md)).
- Physical bay layout (004 §Later).
- Animated progress bars.

## Open questions

- None outstanding. Thresholds per host, `modelShort` as an inventory field and the
  simple host strip were decided 2026-09-29.
