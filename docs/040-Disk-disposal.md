---
type: task
status: in-progress
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

Decided 2026-10-03, after review:

- Disposing a present disk is refused.
- Disposed disks stay in command palette search.
- Undoing a replaced RMA disposal removes the replacement link.
- `salePrice` is positive; a free disposal is a kind (`given-away`, `rma`), not a
  price of 0.

## Contract

### Schema

```ts
// shared/disk.ts
export const DISPOSAL_KINDS = ["sold", "rma", "recycled", "given-away"] as const;
export type DisposalKind = (typeof DISPOSAL_KINDS)[number];
export interface Disposal {
  kind: DisposalKind;
  on: string;             // ISO date, required
  salePrice?: number;     // sold only, > 0; display currency per 051
}

export function isDisposed(disk: { disposal: Disposal | null }): boolean;

export const STATE_OVERRIDES = ["spare", "removed", "dead", "retired"] as const;
export const HISTORY_STATES = ["dead", "retired"] as const;
```

`HISTORY_STATES` / `isHistoryState` (added after this spec) lose `sold`. Every
caller that excludes history disks also excludes disposed ones; see §Visibility.

`Disk`:

- `disposal: json().$type<Disposal>()`, nullable. Null means owned.
- `replacesDiskId: integer().references(() => disk.id, { onDelete: "set null" })`,
  unique where not null: one replacement per disposed disk.

Migration `disk_disposal`, hand-edited after generate to move existing `sold` rows:
`disposal = {kind: "sold", on: <date of latest override-set diary entry to sold, else
today>}`, `stateOverride = null`, `lastState = null` (stale `sold` is outside the
state enum; matters on undo, when `lastState` is next compared). Diary entries are
not rewritten: backfill keeps reading legacy `override-set → sold` as out of
service (§Visibility).

`shared/schemas/disks.ts` disk patch gains:

- `disposal: disposalSchema.nullable().optional()`; `salePrice` rejected unless
  `kind === "sold"`, and `positive()` when given (no price of 0: a free disposal is
  `given-away` or `rma`, not `sold`); `on` no later than UTC today + 1 day (client
  defaults to local today, which runs ahead of UTC overnight in BST).
- `replacesDiskId: z.number().int().positive().nullable().optional()`.

Service rules (`updateDisk`, `ServiceError(400/409)`):

- Setting `disposal` on a disk that is `present` (resolver, `disks.ts` `isPresent`)
  is refused (409, `still attached to mars`). Changing an existing disposal is
  allowed whatever the presence.
- `replacesDiskId` must point at a different disk whose `disposal.kind === "rma"`,
  not already replaced (409).
- Setting or clearing `disposal` writes a diary auto event `disposed` /
  `disposal-cleared` at `now`, `data: { from, to }` (`on` lives in the data, not
  backdated, as `override-set`). Title e.g. `RMA'd on 2026-10-02`, `sold for £40`,
  the price formatted with `shared/money.ts` in the global display currency
  ([051](051-Currency-setting.md)), not a hard-coded `£` and not stored with it.
- Clearing a disposal, or changing its kind away from `rma`, on a disk that a
  replacement points at nulls that replacement's `replacesDiskId` in the same
  transaction and writes `replacement-cleared` on both disks.
- Setting `replacesDiskId` writes `replaced-by` on the old disk and `replaces` on the
  new one, each linking the other. Nulling or re-pointing it writes
  `replacement-cleared` on both sides of the old link.

### State while disposed

Transitions are frozen: `recordStateTransition` returns early for disposed disks, so
an ageing `missing` → `removed` or a lingering override never writes diary entries
or fires alerts. `DiskSummary.state` stays the resolver value
(`stateOverride ?? inferredState`); it is not frozen, so every consumer filters
disposed disks instead. `DiskSummary` carries `disposal`; the UI shows the disposal,
not the state.

Faults: `faults.ts` `inService` and `detectMissing` (not `inService`-filtered today)
both skip disposed disks. Faults already open on a disk when it is disposed resolve
on the next scan via `applyDetections`, with `{ reason: "disposed" }` as
`resolvePoolFaults` does for archived pools.

### Visibility

| Place | Disposed disks |
| --- | --- |
| Topology rails (`groupDisks.ts`), host summary counts (038) | excluded |
| Sidebar status counts (048, `server/services/navigation.ts`) | excluded; SQL filter `disposal IS NULL` beside the existing `HISTORY_STATES` `notInArray` |
| Disks list (table and cards, 050) | excluded unless `disposed=1` in the URL query (`useInventoryQuery.ts`, like `state=`); facet counts in `InventoryFilters.vue` computed over the same filtered set |
| Faults (036/042: `faults.ts` `inService`, `detectMissing`) | excluded; see §State while disposed |
| Fault backfill (`faultsBackfill.ts`) | replays the diary, not rows: `disposed` → out of service, `disposal-cleared` → back; legacy `override-set → sold` still out of service |
| Alert rules (`server/services/alerts/rules.ts`) | `AlertContext.disk()` gains `disposed`; `deriveAlert` drops disk-subject alerts for disposed disks except `disposed-disk-seen`, as archived pools are dropped |
| Fault simulator (044: `simulator/subjects.ts`, `scenarios/presence.ts`) | excluded as subjects, as history disks are now |
| Command palette search (`useEntitySearch.ts`) | included, with the disposal badge |
| Disk page, diary, links from other disks | shown, with a disposal banner |
| `GET /api/disks` | returns all; filtering is the client's (`listDisks` unchanged) |

Row-based filtering uses `isDisposed` at `faults.ts`, `simulator/subjects.ts`,
`scenarios/presence.ts` and `groupDisks.ts` (before grouping, and before
`tileStateMark` / `LIFECYCLE_VOCABULARY[disk.state]` lookups), plus the SQL filter
in `navigation.ts`. Backfill and alerts work as in the table.

### Seen again

Disposing requires the disk to be absent (§Service rules), so any later sighting is
genuine. `observeDisk` on a disposed disk: record the sighting and SMART as usual
(the history is still useful), and once per disposal write a diary auto event
`disposed-disk-seen` (`data: { hostId, disposalOn }`), deduped with
`latestAutoEvent(disk, "disposed-disk-seen")` (`diary.ts`) against the latest
`disposed` entry's `at` (instant, not the day-granular `on`). New alert rule
`disposed-disk-seen` in `shared/alerts.ts`, severity `alert`, subject the disk,
detail `seen on mars, disposed (rma) 2026-10-02`: one `matchDiskEntry` case;
`Alert.dedupeKey` already includes the entry id. The disk page banner turns
`warning` while a `disposed-disk-seen` entry is newer than the latest `disposed`
entry. The user clears the disposal or re-confirms it by hand (re-saving writes a
new `disposed` entry, re-arming the check); nothing is automatic.

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
- Disks list: "Include disposed" switch inside the Filters popover in
  `InventoryFilters.vue` (counts toward its active-count badge); disposed rows
  dimmed with the disposal badge in the state column.
- [037](037-Status-and-icon-vocabulary.md): remove the `sold` row from Lifecycle
  state; add a Disposal table, all neutral: `sold` `i-lucide-banknote`, `rma`
  `i-lucide-package-open`, `recycled` `i-lucide-recycle`, `given-away`
  `i-lucide-gift`. Rail `History` group loses `sold`. In code: move `sold` out of
  `app/utils/vocabulary/lifecycle.ts` into a new `disposal.ts` vocabulary.
- `app/components/topology/groupDisks.ts`: no `sold` rail exists (one History rail
  via `isHistoryState`); filter disposed before grouping.
- Diary: `shared/diary.ts` `DIARY_EVENT_TYPES` and `app/utils/vocabulary/diaryEvent.ts`
  gain `disposed`, `disposal-cleared`, `disposed-disk-seen`, `replaced-by`,
  `replaces`, `replacement-cleared`. Legacy `override-set → sold` entries fall to
  `UNKNOWN_EVENT_ICON` once `sold` leaves the lifecycle vocabulary; accepted.
- `app/components/inventory/types.ts` `InventoryDisk` (hand-listed) gains `disposal`.

### Docs

Update [001](001-Product-goals.md) §Lifecycle and
[003](003-Architecture-and-data-model.md) §Disk state (override set, disposal record,
replaces link).

## Order

1. `shared/disk.ts` types (`HISTORY_STATES` loses `sold`), schema columns,
   migration `0022_disk_disposal` with the `sold` data move.
2. Patch schema and `updateDisk` rules, diary events; service tests.
3. Frozen state for disposed disks; `observeDisk` seen-again event; alert rule.
4. `isDisposed` filtering: faults (`inService`, `detectMissing`, resolve with
   reason), backfill replay, alert rules, sidebar counts, simulator subjects,
   Topology, host counts, Disks list `disposed=1`; palette search badge.
5. Disk page: dispose modal, banner, undo; replaces picker and warranty copy.
6. 037 vocabulary (doc and `app/utils/vocabulary/`), 001, 003.
7. Demo: `seed.ts` gains a `disposals` action beside `overrides` (which replays via
   `updateDisk({ stateOverride })`); W1 (`stories.ts`, currently a `sold` override)
   becomes a sold disposal; add one RMA'd disk with its linked replacement. Update
   the `types.ts` comment and `fleet.test.ts` ("override or disposal").

## Tests

- Migration: a `sold` override becomes `disposal.kind = "sold"` with the diary date,
  override and `lastState` cleared.
- `updateDisk`: salePrice rejected for non-sold and when ≤ 0; date beyond UTC today
  + 1 rejected; disposing a present disk rejected (409); `replacesDiskId` to self,
  to a non-RMA disk, or to an already-replaced disk rejected; diary events written
  for dispose, undo, replace, unlink; clearing a replaced RMA disposal nulls the
  replacement's link.
- Disposed disk ageing past `missingAfterDays` writes no `state-changed` entry and
  opens no `disk-missing` fault; open faults resolve with `reason: "disposed"`.
- Backfill: `disposed` takes a disk out of service; legacy `override-set → sold`
  still does.
- `observeDisk` on a disposed disk: one `disposed-disk-seen` entry across repeated
  sightings; the alert rule matches it; SMART entries on it raise no alerts.
- `groupDisks.test.ts`: disposed disks in no rail.
- Disks list: hidden by default, shown with the toggle; facet counts follow.
- Faults, sidebar counts and simulator subjects skip disposed disks.
- Existing tests relying on a `sold` state move to disposal: `fleet.test.ts`,
  `seed.seeded.test.ts`, `simulator/run.seeded.test.ts`, `navigation.test.ts`,
  `groupDisks.test.ts`, `DiskRail.test.ts`, `test/api/disks.e2e.test.ts`.

## As built

Browser check pending. Deviations from the contract above:

- `DiskSummary` also carries `replacedByDiskId` (reverse of `replacesDiskId`).
- Any non-null `disposal` in a patch writes a `disposed` entry, unchanged or not: that
  is the re-confirm. The banner has Edit…, Undo disposal and (while seen) Re-confirm.
- Sold titles include the date: `sold for £40.00 on 2026-10-02`.
- `AlertDisk` gains `disposal` rather than a `disposed` boolean (the detail needs the
  kind).
- Fault resolution reason travels as `FaultScan.withdrawn`; backfill tracks history
  and disposed disks separately.
- Replaces picker is saved with the inventory form; it shows only when candidates
  exist.
- Demo: W1 sold, A18 RMA'd (new inventory-only disk), A6 its replacement.
- Not handled: `poolFaults.ts` still counts a disposed `missing` disk among missing
  pool members; `detectIdentityConflicts` still runs on disposed disks (their alerts
  are dropped).

## Out of scope

- Net cost of ownership (purchase − sale price) reporting.
- RMA workflow tracking (shipped, received, RMA number). Use notes.
- Bulk dispose from the Disks list.
