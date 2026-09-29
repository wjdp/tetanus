---
type: task
status: todo
---

# Disk disposal

Record that a disk has left your possession (sold, RMA'd, recycled, given away), keep
its SMART history and diary, and stop showing it in lists by default. Spec'd
2026-09-29 from two dead drives about to go back under RMA.

## Why

`stateOverride` mixes three questions in one enum: what the disk is doing (`spare`,
`removed`), whether it works (`dead`), and whether you still own it (`sold`). A dead
drive that is then RMA'd can only be one of `dead` or `sold`, and neither says "gone".
Asset-management tools split this the same way: a lifecycle state while owned, plus a
terminal disposal with a reason (ServiceNow's retired → disposed / sold / donated /
vendor credit).

Decided 2026-09-29:

- Disposal is its own record on the disk, not a state and not diary-only. The diary
  logs it; it is not the source of truth.
- `sold` leaves `STATE_OVERRIDES`. `retired` stays and means owned, working, out of
  service.
- Disposed disks are hidden everywhere except the disk page, with an opt-in on the
  Disks list.
- A disposed disk seen again alerts and stays disposed.
- An RMA replacement can link to the disk it replaces.

## Contract

### Schema

```ts
// shared/disk.ts
export const DISPOSAL_KINDS = ["sold", "rma", "recycled", "given-away"] as const;
export type DisposalKind = (typeof DISPOSAL_KINDS)[number];
export interface Disposal {
  kind: DisposalKind;
  on: string;             // ISO date, required
  salePrice?: number;     // sold only
}

export const STATE_OVERRIDES = ["spare", "removed", "dead", "retired"] as const;
```

`Disk`:

- `disposal: json().$type<Disposal>()`, nullable. Null means owned.
- `replacesDiskId: integer().references(() => disk.id, { onDelete: "set null" })`,
  unique where not null: one replacement per disposed disk.

Migration `disk_disposal`, hand-edited after generate to move existing `sold` rows:
`disposal = {kind: "sold", on: <date of latest override-set diary entry to sold, else
today>}`, `stateOverride = null`, `lastState = null` (so no `state-changed` entry is
written on the next read).

`shared/schemas/disks.ts` disk patch gains:

- `disposal: disposalSchema.nullable().optional()`; `salePrice` rejected unless
  `kind === "sold"`; `on` not in the future.
- `replacesDiskId: z.number().int().positive().nullable().optional()`.

Service rules (`updateDisk`, `ServiceError(400/409)`):

- `replacesDiskId` must point at a different disk whose `disposal.kind === "rma"`,
  not already replaced (409).
- Setting or clearing `disposal` writes a diary auto event `disposed` / `disposal-cleared`
  with `data: { from, to }`. Title e.g. `RMA'd on 2026-10-02`, `sold for £40`.
- Setting `replacesDiskId` writes `replaced-by` on the old disk and `replaces` on the
  new one, each linking the other.

### State while disposed

State is frozen: `recordStateTransition` returns early for disposed disks, so an
ageing `missing` → `removed` or a lingering override never writes diary entries or
fires alerts. `DiskSummary` carries `disposal` and the state as last recorded; the UI
shows the disposal, not the state.

### Visibility

| Place | Disposed disks |
| --- | --- |
| Topology rails, host summary counts (038) | excluded |
| Disks list (table and cards) | excluded unless "Include disposed" is on (filter state, not persisted server-side) |
| Faults, alerts rules for SMART/state | excluded, except §Seen again |
| Disk page, diary, links from other disks | shown, with a disposal banner |
| `GET /api/disks` | returns all; filtering is the client's (`listDisks` unchanged) |

Filtering happens in one shared predicate `isDisposed(disk)` in `shared/disk.ts`.

### Seen again

`observeDisk` on a disposed disk: record the sighting and SMART as usual (the history
is still useful), and once per disposal write a diary auto event `disposed-disk-seen`
(`data: { hostId, disposalOn }`), deduped by checking for an existing one dated after
`disposal.on`. New alert rule `disposed-disk-seen` in `shared/alerts.ts`, severity
`alert`, subject the disk, detail `seen on mars, disposed (rma) 2026-10-02`. The disk
page banner turns `warning` while `lastSeenAt > disposal.on`. The user clears the
disposal or re-confirms it by hand; nothing is automatic.

### RMA replacement

- Disposal badge for `rma` reads `RMA · awaiting replacement` until some disk has
  `replacesDiskId` pointing at it, then `RMA · replaced by K7`. No fault.
- The replacement disk page shows `Replaces K2` in the nameplate area. Setting it
  offers "Copy warranty from K2" when the new disk has no `warrantyExpiry` (vendors
  usually carry the original's remaining warranty over to the replacement).

### UI

- Disk page (`DiskStateControl.vue`): state select loses `sold`. Beside it a
  "Dispose…" button opening a modal: kind, date (default today), sale price (sold
  only). Disposed disks show a neutral banner at the top of the page with kind, date,
  price and an "Undo disposal" action; state control is read-only while disposed.
- Replacement: a "Replaces" disk picker in the inventory form, listing disks with
  `disposal.kind === "rma"` not yet replaced.
- Disks list: "Include disposed" switch in `InventoryFilters.vue`; disposed rows
  dimmed with the disposal badge in the state column.
- [037](037-Status-and-icon-vocabulary.md): remove the `sold` row from Lifecycle
  state; add a Disposal table, all neutral: `sold` `i-lucide-banknote`, `rma`
  `i-lucide-package-open`, `recycled` `i-lucide-recycle`, `given-away`
  `i-lucide-gift`. Rail `History` group loses `sold`.
- `app/components/topology/groupDisks.ts`: drop the `sold` rail, filter disposed.

### Docs

Update [001](001-Product-goals.md) §Lifecycle and
[003](003-Architecture-and-data-model.md) §Disk state (override set, disposal record,
replaces link).

## Order

1. `shared/disk.ts` types, schema columns, migration with the `sold` data move.
2. Patch schema and `updateDisk` rules, diary events; service tests.
3. Frozen state for disposed disks; `observeDisk` seen-again event; alert rule.
4. `isDisposed` filtering: Topology, host counts, Disks list toggle.
5. Disk page: dispose modal, banner, undo; replaces picker and warranty copy.
6. 037 vocabulary, 001, 003.
7. Demo: one sold disk, one RMA'd disk with its linked replacement.

## Tests

- Migration: a `sold` override becomes `disposal.kind = "sold"` with the diary date,
  override and `lastState` cleared.
- `updateDisk`: salePrice rejected for non-sold; future date rejected; `replacesDiskId`
  to self, to a non-RMA disk, or to an already-replaced disk rejected; diary events
  written for dispose, undo, replace.
- Disposed disk ageing past `missingAfterDays` writes no `state-changed` entry.
- `observeDisk` on a disposed disk: one `disposed-disk-seen` entry across repeated
  sightings; the alert rule matches it.
- `groupDisks.test.ts`: disposed disks in no rail.
- Disks list: hidden by default, shown with the toggle.

## Out of scope

- Net cost of ownership (purchase − sale price) reporting.
- RMA workflow tracking (shipped, received, RMA number). Use notes.
- Bulk dispose from the Disks list.
