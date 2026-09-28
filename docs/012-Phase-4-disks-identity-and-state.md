---
type: task
status: done
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

### Server side (identity, registry, state, diary, routes)

Mars data:

- lsblk yields 20 disks (sda–sds plus nvme0n1); loops, zram0 and sr0 are skipped.
  udev and smartctl merge into those 20 with no new rows and no identity conflicts.
- Aliases from udev `disk/by-vdev/*`: K1–K6, L1, L2, L4, M1–M3, Q1, Q3, Q4, Z3, Z4, Z5
  (18). From `vdev_id.conf` only: Z1 (sdq), whose target
  `scsi-SATA_Samsung_SSD_850_H8NPAO4SU23238R` has no udev by-id link, so vdev_id never
  created `by-vdev/Z1`. No alias drift.
- Unresolved `vdev_id.conf` aliases (disk not on mars): L3, L5, Q2, Z2. The NVMe has
  no alias.
- SAS-attached SATA disks: lsblk reports the INQUIRY model (16 chars,
  `WDC WD120EMAZ-11`) and udev `ID_SERIAL` is the NAA (`35000cca…`), not model_serial.
- Scrutiny UUIDv5 for sda (`WDC WD120EMAZ-11BLFA0` + `0UTY8HTE` + `0x5000cca5f853b4e6`)
  is `42e3857b-e3a9-534c-b5a6-3a1c7ace3160`; without wwn,
  `77c89aa3-f51f-567c-bcef-5bdc0c92eae9`. Scrutiny's wwn string is `0x` + lowercase
  hex, so `scrutinyUuid` adds the prefix to our stored form.

Decisions:

- model-serial normalisation also cuts the model to 16 characters (then trims a
  trailing `_`), so smartctl's full model matches lsblk's INQUIRY model and
  `scsi-SATA_<model>_<serial>` by-id names.
- lsblk emits no `udev-serial` key: its serial is the device serial, not `ID_SERIAL`,
  so it could never match. udev is the only source of `udev-serial`.
- `vdev_id.conf` targets resolve through the by-id key, plus the wwn key for
  `wwn-0x…` and the model-serial key for `scsi-SATA_<model>_<serial>`. vdev_id.conf is
  not a sighting: it never creates disks or bumps `lastSeenAt`.
- udev partitions (`ID_PART_ENTRY_NUMBER` or `DEVTYPE=partition`) are ignored; by-vdev
  `-partN` aliases are ignored.
- Identity fields: smartctl overwrites; lsblk only fills empty model, serial and
  capacity, but sets `transport` (sas/sata/nvme). `protocol` comes from smartctl.
- `observeDisk` and `observeDiskFromSmartctl` return `null` (not a row) when an
  observation has no keys or fails; they log and never throw.
- Conflict: returns the lowest-id disk untouched; one `identity-conflict` entry per
  distinct set of disk ids.
- Out-of-order sightings (older than `lastSeenAt`) only lower `firstSeenAt`; they do
  not move host or device path.
- Alias taken by another disk → `alias-drift` with `heldByDiskId`. Automatic alias
  assignment writes an `alias-set` auto event.
- State: `in-use` needs present **and** in a pool, so a pulled pool disk reads
  `missing (was in-use)`. First computation sets `lastState` silently. A PATCH that
  changes the override writes `override-set` and sets `lastState` itself, so no
  duplicate `state-changed` follows.
- Inventory PATCH merges; `null` removes a key. `ageDays`/`warrantyDaysLeft` are
  whole calendar days (UTC). List omits `latestRaw`; detail includes it.
- `POST /api/diary` answers 201.
