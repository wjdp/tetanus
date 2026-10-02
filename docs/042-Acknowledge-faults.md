---
type: task
status: done
---

# Acknowledge faults

A second kind of acceptance: **acknowledge** says "I have seen this, keep watching it"
without hiding it. The attribute stays a fault, but the disk drops from red to amber;
any increase in the value puts it straight back to its real status (red for a `failed`
attribute). Extends the Phase 7 acceptance in
[025](025-Phase-7-diary-and-fault-acceptance.md) and the overlay in
[003](003-Architecture-and-data-model.md) §SMART evaluation.

Motivating case: a disk with 197 Current Pending Sector Count 16 and 198 Offline
Uncorrectable 18, both `failed`, 198 `worsening`. New fault, so accepting it (status
`passed`, no alert until it rises) is too strong; leaving it red leaves the home page
shouting about something already in hand.

## The two kinds

| | accept | acknowledge |
| --- | --- | --- |
| meaning | this level is fine for this disk | I know, watch it |
| attribute display | `accepted` | `acknowledged` |
| contributes to disk status | nothing | `warning` (capped: a `failed` attribute counts as `warning`) |
| superseded when | `value > acceptedValue` | `value > acceptedValue` |
| on supersede | real status back, diary + alert | same |
| typical use | old, stable defect counts | new faults under investigation |

The two kinds differ only in what they do to status; supersession is the same rule.
A decrease (e.g. pending sectors reallocated) does not supersede either kind.

Offered on `failed` and `warning` attributes. On a `warning` attribute acknowledge
changes the row only (the disk is amber either way), but it still marks the fault as
seen and silences its alerts until it rises.

Health still wins: `smartPassed === false` or exit-status bit 3 keeps the disk `failed`
whatever is acknowledged or accepted, as today.

## Contract

### Data

`FaultAcceptance` gains `kind text NOT NULL DEFAULT 'accept'`, values
`ACCEPTANCE_KINDS = ["accept", "acknowledge"]` in `shared/smart/status.ts`. Existing
rows migrate as `accept`. Table and other column names unchanged (`acceptedValue` is
the level for both kinds). Migration `fault_acceptance_kind`. Still at most one active
row per (disk, attr), of either kind.

### Overlay (`shared/smart/status.ts`)

- `AttributeDisplayStatus = AttributeStatus | "accepted" | "acknowledged"`.
- `AcceptedLevel` gains `kind`.
- `isCovered(acceptedValue, value)`: `value <= acceptedValue` for both kinds. One
  function used by both the overlay and supersession so they cannot drift.
- `overlayStatus`: `passed` stays `passed`; covered → `accepted` / `acknowledged`;
  otherwise the real status. That branch is defensive only: only the latest reading
  is overlaid, and ingest supersedes before computing status.
- `effectiveDeviceStatus`: `accepted` contributes nothing, `acknowledged` contributes
  `warning`, others their status.

### Service (`server/services/acceptance.ts`)

- `acceptFault({ diskId, attrId, kind = "accept", note, now })`.
- Switching kind: POST with the other kind while one is active clears the active row
  (`clearedAt`) and inserts the new one in the same transaction; diary records the
  new one only, with `data.replaces: <kind>`. Same kind while active → 409 as today.
  Lets "acknowledge now, accept once it has been stable a month" be one click.
- `supersedeIfRisen` handles both kinds, using `isCovered`. Diary title for
  acknowledge: `${name} rose to ${value} (acknowledged at ${acceptedValue})`.
- `recomputeLatestStatus` unchanged in shape; status now moves `failed → warning` on
  acknowledge and back on clear/supersede, writing `smart-status-changed` as today.
  `smart-status-changed` data gains `acknowledged: attrId[]`.
- Switching kind sets `clearedAt` on the old row with no `*-cleared` event; the
  `fault-*` entry's `replaces` is the record. The new row's `acceptedValue` is the
  current value, which may be lower than the old one.
- Attribute missing from a reading: supersession skips it and the row stays active
  (as today, `acceptance.ts` `supersedeIfRisen`). Intended; do not "fix".

### Diary

New event types, mirroring the accept trio rather than overloading them, so the
timeline and alert rules read clearly:

| eventType | data | icon |
| --- | --- | --- |
| `fault-acknowledged` | `{ attrId, acceptedValue, trend, note, replaces? }` | `i-lucide-eye` |
| `acknowledgement-superseded` | `{ attrId, acceptedValue, value }` | `i-lucide-eye-off` |
| `acknowledgement-cleared` | `{ attrId, acceptedValue }` | `i-lucide-eye-off` |

`fault-accepted` gains optional `replaces`.

### Alerts

- New rule `acknowledgement-superseded`, label "Acknowledged fault worsened", severity
  `alert`, dedupe value `${attrId}@${value}`.
- `AlertContext.isAccepted` → `hasActiveAcceptance(diskId, attrId)`, true for either
  kind, so `attribute-failed` stays quiet for acknowledged attributes. (Renamed so it
  does not collide with the value-based `isCovered`.)
- Duplicate alerts, a bug accept has today and this fix shares. One ingest runs
  `supersedeIfRisen` then `recordStatusChange` (`server/services/smart.ts`), so one
  tick carries `*-superseded` + `smart-status-changed → failed`, and dedupe keys
  include the entry id so nothing collapses. Worse when the attribute also changes
  status (acknowledged at `warning`, now `failed`): `attribute-status-changed` is
  written regardless, and by tick time the row is inactive, so `attribute-failed`
  fires too. Three alerts for one event. Fix in `deriveAlerts`
  (`server/services/alerts/rules.ts`): per disk per tick, when a `*-superseded`
  entry is present, drop `disk-failed` and `attribute-failed` for that attr.
- Accepting or acknowledging a `failed` attribute moves the disk out of `failed`,
  which fires `disk-recovered` (accept does this today, `failed → passed`). A user
  click is not a recovery: in the same pass, drop `disk-recovered` when the tick has a
  `fault-accepted` / `fault-acknowledged` for that disk.

### API

- `POST /api/disks/:id/accept` `{ attrId, kind?: "accept" | "acknowledge", note? }`
  (`faultAcceptanceInputSchema` gains `kind`, default `accept`). 201 / 409 / 404 as
  today.
- `DELETE /api/disks/:id/accept/:attrId` clears whichever kind is active.
- `LatestAttribute.acceptance` and `FaultAcceptanceRow` carry `kind`.

### Faults page ([036](036-Faults-page.md))

A disk amber only through acknowledgement derives `disk-warning`, not `disk-failed`.
036's `disk-warning` row now says "device status `warning`" (acknowledged still counts;
accepted does not). 036 is not built yet, so this was a doc change only.

### UI

Vocabulary ([037](037-Status-and-icon-vocabulary.md)): both are amber, acknowledged
the stronger form because it still counts towards disk status.

| display status | colour | shape / icon | value cell | row tint |
| --- | --- | --- | --- | --- |
| `acknowledged` | warning | filled dot; `i-lucide-eye`; label `ack` | "ack at 16" | `bg-warning/5` |
| `accepted` | warning | hollow dot; `i-lucide-shield-check` | "accepted at 16" | `bg-elevated/40` (as today) |

`accepted` is unchanged. Acknowledged takes the filled dot: per 037's grammar, filled
is a definite reading that counts, hollow is qualified; the icon and value-cell text
tell acknowledged apart from a plain `warning` row. 037's attribute table gains the
`acknowledged` row; its diary icon table gains the three new events.

Attribute table (`DiskAttributeTable.vue`), actions column:

- `failed` / `warning`: one `Acknowledge` button; the modal preselects acknowledge
  and offers accept too.
- `acknowledged`: `Accept`, `Clear`. The modal opened from here offers accept only
  (the active kind is hidden from the radio), so it cannot 409.
- `accepted`: `Clear` (as today).

`AcceptFaultModal` gains a kind choice (`URadioGroup`, two items with one-line
descriptions from the table above), title and confirm label follow the kind. Toasts
neutral. Status line: `· N acknowledged` beside `· N accepted`; `countByStatus` and
`STATUS_GROUP` gain `acknowledged` (sorted after `warning`, before `accepted`).
`DiskAttributeDetail` history lines say "acknowledged at …" / "accepted at …". 409
toast reads "Already acknowledged" / "Already accepted" by kind.

Every place keyed on display status, in `DiskAttributeTable.vue` unless noted:

- `ROW_TINT` (typed `as const`, fails to compile until `acknowledged` is added).
- Status-cell tooltip, disabled unless `accepted`: enable for `acknowledged` too.
- Value cell `v-if="displayStatus === 'accepted'"`, `acceptedAt()` and the
  `accepted-value` testid: generalise by kind.
- Auto-expand watch on `failed | warning`: include `acknowledged`.
- `ATTRIBUTE_STATUS_DOT` in `attributeRows.ts` (exhaustive `Record`).
- `DiskSmart.vue` `reasonSummary` / `faultCount` count `failed` + `warning` only; a disk
  amber only through acknowledgement would show `warning` with no reason. Include
  acknowledged attributes ("2 acknowledged attributes").

Disk dot, Disks table, home tiles: plain `warning` from `DeviceStatus`; no new device
status.

### Demo

`AcceptanceSeed` (`server/demo/types.ts`) gains `kind`; `server/demo/seed.ts` forwards
it to `acceptFault`. Two stories in `server/demo/stories.ts`: one acknowledged fault
that holds (filled amber row, amber disk), and one on another disk acknowledged then
bumped by one (supersede, back to red, one alert).

Diagnostics export (`server/services/diagnostics.ts`) dumps the raw table: `kind`
comes along with no change.

### Tests

- `shared/smart/status.test.ts`: `isCovered`, overlay, device status
  capping (`failed` + acknowledged → `warning`; health failed stays `failed`).
- `server/services/acceptance.test.ts`: acknowledge, supersede on +1, no
  supersede on unchanged or lower value, switch kind, clear.
- `server/services/alerts/rules.test.ts`: new rule; `attribute-failed` suppressed;
  `isAccepted` mock renamed; one alert per supersede; no `disk-recovered` on
  accept/acknowledge.
- `server/services/alerts/dispatch.test.ts`.
- `test/api/acceptance.e2e.test.ts`: `kind` round-trip, default, invalid kind 400.
- `attributeRows.test.ts`: ordering and counts with `acknowledged`.
- `app/pages/disks/id.test.ts`, `DiskSmart.test.ts`: acknowledge actions, reason text.
- `server/demo/seed.test.ts`, `stories.test.ts`.
- `MIGRATION_COUNT` in `server/database/migrate.test.ts` (12 → 13).

### Docs

On landing: 003 §SMART evaluation and data model line, 037 attribute and diary icon
tables, 036 kind table, 025 untouched (history).

## Out of scope

- Acknowledging a whole disk or pool state (pool `DEGRADED`, disk missing). Faults
  page dismissal (036) covers the non-SMART cases.
- Expiry ("acknowledge for 7 days").
- Bulk "acknowledge all" on a disk: each attribute is acknowledged on its own.
- Acknowledging health-level failure (`smartPassed === false`).

## Findings

Built 2026-10-02.

Deviations from the contract:

- **Alert suppression is per entry, not per tick.** Collapsing in `deriveAlerts` would
  depend on which entries share a pass and would not hold for retries, which re-derive
  one entry at a time (`rederive` in `dispatch.ts`). Instead the diary entries say why
  they happened and `deriveAlert` reads that:
  - `smart-status-changed.data` gains `cause: "reading" | "acceptance" | "policy"` and
    `superseded: attrId[]`. `cause: "acceptance"` (accept, acknowledge, clear, switch)
    never alerts, in either direction; that also silences `disk-failed` after a clear,
    which the contract did not mention but is the same "a click is not news" rule.
    `disk-failed` is skipped when `superseded` is non-empty: the supersede alert says it.
  - `attribute-status-changed.data` gains `superseded: boolean`; `attribute-failed` is
    skipped when true.
  - `policy` (`reapplySmartPolicy`) alerts as before.
- `supersedeIfRisen` keeps its name and now returns the superseded attrIds.
- Status line reads "1 warning, 1 acknowledged attributes"; the clear confirm and its
  error toast name the kind. The detail panel heading is "Acknowledgements and
  acceptances".
- Demo: A7's reallocated sectors acknowledged 12 h after they fail and superseded at
  the next rise; A12 has 2 new pending sectors from 6 days before the anchor,
  acknowledged and holding (filled amber row, amber disk). The A7 acknowledgement had
  to be 12 h, not 2 h, after the failure: earlier than the next SMART reading it
  acknowledged the still-passing value 16, and the rise to 17 then superseded it and
  swallowed the `attribute-failed` alert the demo seeds.

Notes:

- Acknowledging an attribute whose latest reading is `passed` is allowed (as accept
  is) and has the effect above: the next rise supersedes it silently apart from the
  `*-superseded` alert. The UI only offers it on `failed` / `warning` rows.
- The dev database needs `pnpm db:migrate` for `0012_fault_acceptance_kind`.
