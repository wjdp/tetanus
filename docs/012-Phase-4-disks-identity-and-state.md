---
type: task
status: todo
---

# Phase 4 disks identity and state

Phase 4 of the [project plan](004-Project-plan.md): the disk registry, identity
matching, alias resolution, state inference, inventory. Design in
[003](003-Architecture-and-data-model.md) §Identity, §Disk state, §Inventory fields.

## Contract

### Identity (`server/services/identity.ts`, pure)

`extractKeys(observation)` from any of: smartctl-xall (`wwn`, `model-serial`),
lsblk (`wwn`, `model-serial`, `udev-serial` when serial present), udev (`ID_WWN`,
`ID_SERIAL`, `by-id` for each `disk/by-id/*` symlink excluding `-part`). Normalisation
per 003: WWN lowercase no `0x`; model-serial = `${model}|${serial}` upper, `WD-` prefix
stripped from serial, `_`/space collapsed to one `_`.

`matchDisks(keys, existing: { diskId, kind, value }[])` → `{ diskId } | { conflict:
diskId[] } | null`. Any key match wins; two different disks → conflict.

`scrutinyUuid(model, serial, wwn)` = UUIDv5 over `model + serial + wwn` (raw smartctl
strings, wwn as our lowercase hex or `""`) with namespace
`3ea22b35-682b-49fb-a655-abffed108e48`. Test against a value computed with
scrutiny's Go function for one mars disk (run `go test` or a one-off in the checkout to
get it; record it in findings).

### Registry (`server/services/disks.ts`)

- `observeDisk({ hostId, receivedAt, keys, identity, devicePath?, deviceType? })` →
  `Disk`: match, merge new keys, update identity fields when present, `lastSeenAt`,
  `lastSeenHostId`, `lastDevicePath`. Create when no match. Conflict → diary
  `identity-conflict` on the older disk, no merge, return the first. Never throw.
- Host change → diary `moved-host` ("moved from mars to X").
- Ingest handlers (exported for wave-wiring): `smartctl-scan` (nothing to persist
  beyond the run), `lsblk` (observe every whole disk with a serial), `udev` (observe by
  keys, set `alias` from `disk/by-vdev/<alias>` symlink when the disk has none; when it
  differs record `aliasDrift` in findings and don't overwrite), `vdev-id-conf` (resolve
  targets through `by-id` keys; set missing aliases; drift as above).
  `smartctl-xall` observes but leaves reading persistence to Phase 3:
  export `observeDiskFromSmartctl(hostId, meta, parsed, receivedAt)`.
- State: `inferState(disk, { inPool: boolean, present: boolean, now, missingAfterDays })`
  → `in-use | spare | missing | removed | unseen`; `effectiveState = override ??
  inferred`. `present` = seen by any source on its last host within one SMART cadence
  (2 h). `inPool` comes from `Vdev.diskId` (Phase 5); until then false. Transitions of
  effective state → diary `state-changed`. Compute on read in `listDisks`/`getDisk`;
  persist `Disk.lastState` so transitions can be detected on the next read.
- Override: `PATCH /api/disks/:id` with `{ stateOverride: null | spare | removed | dead
  | sold | retired }` → diary `override-set`.
- Inventory: `shared/inventory-fields.ts` (wave 1) drives `inventoryPatchSchema`; PATCH
  accepts `{ inventory: Partial<...>, notes?, alias? }`. Alias unique across hosts
  (409 on clash).
- `listDisks()` → rows with `keys`, effective state, host name, `latest*`, computed
  `ageDays` (from `inventory.purchaseDate`), `warrantyDaysLeft`.
  `getDisk(id)` adds diary entries and keys.

### Diary (`server/services/diary.ts`)

`addAutoEvent({ subjectType, subjectId, eventType, title, data?, at? })`,
`addManualEntry`, `listDiary({ subjectType?, subjectId?, limit })`. Routes
`GET /api/diary?subjectType=&subjectId=` and `POST /api/diary` (manual, zod schema in
`shared/schemas/diary.ts`).

## Findings

(agents append here)
