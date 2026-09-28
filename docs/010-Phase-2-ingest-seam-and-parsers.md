---
type: task
status: in-progress
---

# Phase 2 ingest seam and parsers

Phase 2 of the [project plan](004-Project-plan.md): the ingest route, the parsers for
every v1 source, and the host collector. Design in
[003](003-Architecture-and-data-model.md). This doc is the contract the agents build to;
findings go at the bottom.

## Contract

### Route

`POST /api/ingest/:source`, body `text/plain` (raw stdout), limit 16 MiB.

Headers, both required:

- `Authorization: Bearer <enrolToken>` (from `Setting`). Missing or wrong → 401.
- `Tetanus-Host: <name>` (collector sends `hostname -s`). Normalised lowercase, trimmed;
  must match `^[a-z0-9][a-z0-9.-]{0,62}$` → otherwise 400. Header name is
  `${APP_NAME}-Host` in title case, derived in `shared/ingest.ts`.

Query, smartctl sources only: `device` (e.g. `/dev/sdc`), `type` (smartctl `-d` value or
absent), `exitStatus` (smartctl bitmask as integer; non-zero is data, never an error).

Behaviour, in order:

1. Auth. 2. Host upsert by name (`firstSeenAt`, `lastSeenAt`). 3. Unknown `source` → 400.
4. Parse with the registered parser. Parse failure → `CollectorRun.ok=false` with the
   error message, response 422 `{ ok: false, error }`. 5. Success → upsert `Payload`,
   `CollectorRun.ok=true`, response 200 `{ ok: true, source, host, summary }` where
   `summary` is whatever small object the parser returns as `summary` (counts, names).

`Payload` keeps only the latest raw body per `(hostId, source, device)`; `CollectorRun`
keeps a row per POST without the body. Persisting parsed data into domain tables is
Phases 3–5; in Phase 2 the parsed object is returned and discarded.

### Sources

| source | command on host | parser output (sketch) |
| --- | --- | --- |
| `versions` | `KEY=value` lines: `zfs`, `zpool`, `kernel`, `smartctl`, `os` | `Record<string,string>`; stored into `Host.toolVersions` |
| `smartctl-scan` | `smartctl --scan --json` | `{ devices: [{ name, type, protocol }] }` |
| `smartctl-xall` | `smartctl --xall --json -n standby [-d type] <dev>` | see below |
| `lsblk` | `lsblk -J -b -o NAME,TYPE,SIZE,MODEL,SERIAL,WWN,TRAN,ROTA,MAJ:MIN,PATH,PTTYPE,PARTUUID,FSTYPE` | `{ disks: [{ name, path, majMin, sizeBytes, model, serial, wwn, transport, rotational, partitions: [...] }] }` |
| `udev` | `cat /run/udev/data/b<maj>:<min>`, query `device=b8:16` | `{ properties: Record<string,string>, symlinks: string[], aliases: string[] (from `disk/by-vdev/`), byId: string[] }` |
| `vdev-id-conf` | `cat /etc/zfs/vdev_id.conf` | `{ aliases: [{ alias, target }] }`, both `alias` line forms, unknown directives ignored |
| `zpool-status` | `zpool status -j --json-flat-vdevs --json-int -Ppvs` | pools with vdev tree (by `parent`/`guid`), state, error counters, slow IOs, scan, errors block |
| `zpool-list` | `zpool list -j --json-int -pv` | pools with guid + numeric properties |
| `zfs-list` | `zfs list -j --json-int -p -t filesystem,volume -o <cols>` (cols as in `test/fixtures/mars/manifest.txt`) | datasets with numeric props |
| `zfs-snapshots` | `zfs list -j --json-int -p -t snapshot -o name,used,referenced,written,creation -s creation` | snapshots |
| `zpool-history` | `zpool history -il \| tail -n 500` | `{ entries: [{ at, internal, text, pool }] }` |
| `zpool-events` | `zpool events -vH` | `{ events: [{ eid, at, class, poolGuid?, vdevGuid?, fields: Record<string,string> }] }`, hex strings decoded to decimal strings, nested nvlists flattened with dot paths |
| `zed-event` | ZED hook posts `KEY=value` lines for every `ZEVENT_*` env var | one event in the same shape as above |

Every ZFS JSON parser checks `output_version.vers_major === 0` and throws otherwise.
Parsers are pure `(body: string, meta: IngestMeta) => { data: T; summary: object }`
in `server/ingest/<source>.ts`, exported as `parse`, tested against
`test/fixtures/mars/**`, `test/fixtures/scrutiny/*.json` and
`test/fixtures/events/*.txt`. The registry `server/ingest/registry.ts` maps source name
→ parser; `shared/ingest.ts` holds the source name list and the header name.

`smartctl-xall` output: `{ device: { name, type, protocol }, smartctl: { version, exitStatus (bitmask decoded to flags) }, identity: { model, modelFamily?, serial, firmware, wwn? (lowercase hex from wwn.{naa,oui,id}), capacityBytes (nvme_total_capacity then user_capacity.bytes), rotationRate?, formFactor?, transport? }, smartSupport: { available, enabled } (both shapes), smartStatus: { passed }?, standby: boolean (exit bit 1 with no data), temperature?, powerOnHours?, powerCycles?, ata?: { attributes: [{ id, name, value, worst, thresh, whenFailed, raw: { value, string } }] }, nvme?: { ...smart_health_information_log }, scsi?: { grownDefects, readErrors..., }, selfTests?: [...], sctTemperatureHistory?: { intervalMinutes, values: number[] } }`.

### Host collector

`host/tetanus-collect` (bash, curl only, no jq), a template unit `tetanus-collect@.service`
with three timers: `zfs` every 10 min (versions, zpool-status, zpool-list, zfs-list,
zpool-history, zpool-events, vdev-id-conf), `smart` hourly (lsblk, udev, smartctl-scan,
smartctl-xall), `snapshots` every 6 h (zfs-snapshots). `host/zed/all-tetanus.sh`,
`host/install.sh`. Decided 2026-09-28: bash stays until the collector needs per-device
config or platform quirks, then Go; `zpool iostat` dropped from v1.
Config in `/etc/tetanus/collect.env`: `TETANUS_URL`, `TETANUS_TOKEN`, optional
`TETANUS_HOST` (defaults to `hostname -s`). Clears `ZPOOL_VDEV_NAME_GUID`,
`ZPOOL_VDEV_NAME_FOLLOW_LINKS`, `ZPOOL_VDEV_NAME_PATH`. Runs every source in the table,
smartctl per scanned device with `-n standby`, `-d <type>` only when the scan type is not
`ata`/`scsi`/`sat`, and POSTs stdout with the smartctl exit status. Never fails the whole
run because one command failed. Read-only, no host writes beyond its own log line.

## Findings

(agents append here)

### Ingest seam foundations

- `Payload.device` is `NOT NULL DEFAULT ''` (`NO_DEVICE` in the schema), not nullable.
  SQLite treats NULLs as distinct in unique indexes, so a nullable `device` would let
  `unique(hostId, source, device)` hold many device-less rows and break the upsert. An
  empty string keeps the index a plain column index Drizzle's `onConflictDoUpdate` can
  target; a generated key column would add a second column for no gain.
  `CollectorRun.device` stays nullable: it has no unique index.
- Any exception a parser throws counts as a parse failure (422, `CollectorRun.ok=false`),
  not only `ParseError`: parsers read untrusted text, and a stray `TypeError` or
  `JSON.parse` `SyntaxError` is still bad input, not a server fault. `ParseError`
  (`server/ingest/parseError.ts`) is for deliberate rejections with a readable message.
- `Parser<T> = (body: string, meta: IngestMeta) => IngestResult<T>` where
  `IngestResult<T> = { data: T; summary: Record<string, string | number> }`, in
  `shared/ingest.ts`. The registry is `Record<IngestSource, Parser<unknown>>`, so
  adding a source to `INGEST_SOURCES` without a parser fails typecheck.
- `versions` is the only parser that persists in Phase 2: `recordIngest` replaces
  `Host.toolVersions` with its output. It strips one pair of matching quotes from
  values (`os="Ubuntu 24.04"`), keeps everything after the first `=`, ignores blank and
  `#` lines, and rejects a non-empty line with no key.
- A failed parse records the run but leaves `Payload` alone, so the last good body
  survives a bad POST.
- Body limit: a declared `Content-Length` over 16 MiB is refused before reading; the
  read body is checked again for chunked uploads. Both answer 413. h3 buffers the whole
  body first, so a chunked upload is only refused after it arrives.
- The enrol token is compared as SHA-256 digests with `timingSafeEqual`, so neither
  length nor content leaks through timing.
- An unknown source still upserts the host first, per the order in the contract.
- `exitStatus` accepts decimal digits only, 0–255; `device` and `type` are trimmed,
  1–256 characters. Invalid query → 400.
- Route tests reach into the database with raw SQL rather than Drizzle: using the
  Drizzle schema types in a `test/api` file pushed the typed `$fetch` route matcher past
  TypeScript's stack depth (TS2321) in `settings.e2e.test.ts`. Server-side typed
  `$fetch` of the new routes is fine.
- 003's data model sketch still lists `CollectorRun` with `startedAt`/`finishedAt`; the
  table as built has `receivedAt` plus `device`, `deviceType` and `exitStatus`, since the
  server only sees when a POST arrives.

Host collector:

- Three timers drive one template unit, `tetanus-collect@.service`, via `--only zfs |
  smart | snapshots`. Hardening kept: `ProtectSystem=strict`, `ProtectHome`,
  `PrivateTmp`, `NoNewPrivileges`, `ProtectKernelTunables`, `ProtectControlGroups`,
  `RestrictSUIDSGID`, `RestrictRealtime`, `LockPersonality`. Left out because they
  block `/dev/sd*`, `/dev/nvme*` or `/dev/zfs`: `PrivateDevices`, `DevicePolicy`,
  `CapabilityBoundingSet`, `User=`, `ProtectClock`, `ProtectKernelLogs`.
- The token reaches curl through `-H @<(…)`, never argv, so it does not show in `ps`.
  Config is read as `KEY=value` lines, never sourced.
- `udev` is posted for whole disks only (lsblk type `disk`); the whole-disk record
  carries the `disk/by-vdev/<alias>` link, so partition records are not needed.
- On mars `smartctl --scan` reports `-d scsi` for every SATA disk behind the HBA. The
  collector omits `-d` for `ata`/`scsi`/`sat`, so the `xall-*-auto.json` fixtures are
  the real input; the `-d scsi` captures are kept for comparison only.
- A command that exits 0 with no output still posts an empty body (e.g. `zpool history`
  with no pools), so every parser rejects an empty body with a `ParseError` and the run
  is recorded as failed. A non-zero exit with no output is skipped and logged.
- The ZED hook posts every event class; busy pools will send many `history_event` and
  `config_sync` events. Phase 5 should dedupe on `(hostId, eid)`.
- The installer's curl one-liner points at `raw.githubusercontent.com/wjdp/tetanus`,
  which assumes the publication repo. The working remote is Gitea `wjdp/diskbot`.
- Shell tests (`pnpm test:host`, 21 cases) stub `zpool`, `zfs`, `smartctl`, `lsblk` and
  `curl`; the stubs replay `test/fixtures/mars` only when argv matches `manifest.txt`
  exactly, so the tests pin every command line to what was captured on the real host.
  CI has a separate `host` job with shellcheck and bats.
