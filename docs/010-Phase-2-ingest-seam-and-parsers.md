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
