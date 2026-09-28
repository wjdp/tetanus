---
type: review
status: open
---

# Prior art and problem space

Research snapshot, 2026-09-28. Sources: `~/local/scrutiny` @ `4e92271` (v0.9.4),
`~/local/grate` @ HEAD, the author's mars notes and `vdev_id.conf`, OpenZFS 2.2/2.3
docs. Investigation run from `odyssey`, a laptop with no ZFS or smartmontools, so no
live command output was captured. Fixtures from mars are the first thing needed.

## What's wrong today

Two systems, neither complete:

- **scrutiny** knows SMART but not disks. Identity is `/dev/sdX` in the UI, so the
  dashboard has duplicate `/DEV/SDI` cards from reused paths. Removed disks look like
  live ones with a red "last updated". Status is sticky and binary; `K2` with 16 pending
  sectors is "FAILED" forever with no way to say "known, fine". No labels, no notes, no
  muting (per-device notifications dropdown is a "not yet implemented" stub). Temperature
  chart with 26 series is unreadable. Needs InfluxDB. Compose needs every `/dev/sdX`
  listed by hand and drifts when disks change.
- **Obsidian** knows disks but not health. 24 notes with alias, model, serial, capacity,
  pool, status (`ONLINE | SPARE | REMOVED`), purchase date, 3.3 V pin flag, and a Bases
  table with an age formula. Maintained by hand, never cross-checked against reality.

The H1–H4 generation (2018 4 TB WD Reds) exists only in Obsidian: not in
`vdev_id.conf`, never seen by scrutiny. Inventory rows must be able to exist with no
device behind them.

## Scrutiny: what to take

Licence MIT. Porting code and data is fine with notice retained.

### Architecture

Two Go binaries. The **collector** is a thin shell wrapper: `smartctl --scan --json`,
`smartctl --info --json`, `smartctl --xall --json` per disk, udev enrichment from
`/run/udev/data/b<maj>:<min>`, then POSTs raw smartctl stdout to the web API. **All
interpretation is server-side** in the web backend. Storage is split: device registry in
SQLite (GORM), all time series in InfluxDB 2 with four cascading retention buckets
(15 days raw → weekly 9 weeks → monthly 25 months → yearly forever).

Collector-facing API is two unauthenticated endpoints, stable since v0.9.0:

- `POST /api/devices/register` — `{"data":[Device…]}` in, `{"success":true,"data":[Device…]}` out. Collector collects whatever the server returns.
- `POST /api/device/:scrutiny_uuid/smart` — raw `smartctl --xall --json` body. Response ignored.

### The valuable part is data

`webapp/backend/pkg/thresholds/`: 81 ATA, 16 NVMe, 13 SCSI attribute entries with
`display_name`, `ideal`, `critical`, `description`, `display_type`
(raw/normalized/transformed), and `observed_thresholds` (Backblaze annual failure rate
buckets with error intervals; 130 buckets over 16 ATA attributes). The agent compiled it
to JSON: 67 KB, verified lossless. Two `Transform` closures need hand-porting:

- 194 Temperature: `raw & 0xff`.
- 188 Command Timeout: Seagate triple-value, take the third if non-decreasing.

Critical ATA attributes: 5, 10, 184, 187, 188, 196, 197, 198, 201.

### Evaluation logic (~150 lines)

Two bitmasks: attribute `Passed=0 | FailedSmart=1 | WarningScrutiny=2 | FailedScrutiny=4`,
device `Passed=0 | FailedSmart=1 | FailedScrutiny=2`.

ATA per attribute: `when_failed == FAILING_NOW` → FailedSmart, stop. `IN_THE_PAST` →
WarningScrutiny, continue. Then pick value by `display_type`, find the Backblaze bucket
containing it, record `failure_rate`; critical and AFR ≥ 10% → FailedScrutiny;
non-critical AFR ≥ 20% → FailedScrutiny, ≥ 10% → WarningScrutiny; critical with no bucket
→ WarningScrutiny.

NVMe/SCSI: fixed thresholds (`critical_warning` 0, `media_errors` 0, `available_spare`
vs the device's own threshold, `percentage_used` 100, grown defects 0, uncorrected 0),
compared by `ideal` direction.

Device: `!smart_status.passed` → FailedSmart; any FailedScrutiny attribute →
FailedScrutiny. Written unconditionally each upload.

`metrics.status_threshold` and `status_filter_attributes` gate **notifications only**;
the dashboard decodes the raw bitmask client-side against the user's threshold. That
split is a documented source of confusion; diskbot should apply one threshold everywhere.

Test corpus: `webapp/backend/pkg/models/testdata/*.json`, ~20 real smartctl outputs
(ATA, NVMe, SCSI, SAT, megaraid, failing drives) with expected statuses in
`measurements/smart_test.go`. Port as-is.

### Fiddly bits worth copying

- `-d <type>` only passed when type is not `ata`/`scsi` or user overrode it. In Docker,
  ATA disks are often detected as `scsi`, and forcing `-d scsi` loses ATA data.
- After `--info`, don't overwrite device type if set: smartctl reports resolved transport
  (`sat`) not the addressing path (`megaraid,0`).
- smartctl exit status is a bitmask; failing disks exit non-zero. Never treat non-zero
  as "no data".
- `smart_support` changed shape (bool → `{available, enabled}`) across versions.
- Capacity: `nvme_total_capacity` then `user_capacity.bytes`.
- WWN reassembled from `wwn.{naa,oui,id}`; smartctl only reports it for ATA. NVMe/SCSI
  need sysfs/udev.
- Identity: UUIDv5 over `model + serial + wwn` with namespace
  `3ea22b35-682b-49fb-a655-abffed108e48`, because "WWN's are not actually unique". Port
  exactly; it makes the scrutiny importer trivially joinable.
- SCT temperature history backfill from `ata_sct_temperature_history`, timestamps
  aligned to the logging interval so repeat collections are idempotent.
- `collector.yaml` `devices:` override language: per-device `type` (string or list for
  RAID expansion), `ignore`, per-device args, `allow_listed_devices`.
- `docs/TROUBLESHOOTING_DEVICE_COLLECTOR.md`: catalogue of SMART-in-container failure
  modes. NVMe needs `SYS_ADMIN` and the controller node `/dev/nvme0`, not `/dev/nvme0n1`.
- Builds smartmontools 7.5 statically and runs `update-smart-drivedb` at image build.

### Don't copy

- InfluxDB.
- Sticky device status with no reset.
- `smart_scsci_attribute.go:76` looks up NVMe metadata for SCSI, so SCSI scrutiny
  evaluation is dead code.
- No last-seen timestamp, no offline state.
- `Label` field nothing writes; `/api/common/search` route that doesn't exist.

### Reuse options

(a) Run their collector binary, implement the two POST routes in Nitro. ~80 lines of
Nitro, but ships a Go binary and cron, and you still port the evaluation.
(b) Call `smartctl --json` from Node, port ~600–900 lines of TS (types, evaluation,
detection quirks). (c) Vendor the metadata JSON regardless.

Recommendation from the analysis: (c) + (b), design a seam so (a) can bolt on later.
Author's decision: (c) now, (a) vs (b) later; both work.

## grate: what to inherit

Full report in the session scratchpad; the relevant conclusions:

- Stack and layout: Nuxt 4 `app/`/`server/`/`shared/`, Nitro auto-registers only
  `api|routes|middleware|plugins|tasks|utils`; `database/`, `services/` are plain
  modules. Biome bans `app/`→`server/` imports. Zod v3 schemas in `shared/schemas/`
  passed to h3 validated helpers. Responses wrapped in a key. `ServiceError` keeps h3 out
  of services.
- Migrations: drizzle-kit generated SQL, hand-named, run by a Nitro plugin at boot in
  prod and `pnpm db:migrate` in dev; FK enforcement toggled around the migrator.
- Background work: Nitro tasks + a serial queue on `useStorage()`, SSE progress via a
  typed `SseMessageMap`, cron only enqueues. Provider registry + generic runner that
  isolates per-source failures. Follow-up queueing from structured job results.
- Fault banners (docs/29): derived-on-request health, dismissed per fault key. Exactly
  what diskbot needs for "collector silently dead".
- Tests: per-file `:memory:` DB via `DATABASE_URL`, `runMigrations` in `test/setup.ts`,
  faker factories, co-located tests, e2e via spawned `nuxt dev`.
- Docker: 4-stage `node:24-slim` build, `run.sh` refuses to start without `/app/data`,
  healthcheck on `/health`, no `USER` (compose sets `user:`), TZ is the only env var,
  settings in DB.
- Timeline derivation (docs/22): raw snapshots never rewritten; deltas of cumulative
  counters carry an observation window not a point; first sample is baseline not event;
  negative deltas skipped. Maps directly onto SMART counters.
- Lessons: typecheck from day one; test infra before features; no tRPC; retention
  decided in the first schema; periodic collector must self-heal on unknown entities;
  design the source registry before the second source; never require a button press for
  routine polling.

## ZFS and host facts that shape the design

- **`zpool -j` JSON is OpenZFS 2.3+.** mars runs 2.4.1 on Ubuntu 26.04, so JSON is
  the only format diskbot parses for `zpool status`, `zpool list`, `zfs list`, `zfs get`.
  Minimum supported host is "Ubuntu 26.04-like". `zpool iostat` has no `-j` at any
  version and stays text. `-j` without `-p`/`--json-int` returns human strings
  (`"159T"`, `"9%"`); always pass both. Environment variables `ZPOOL_VDEV_NAME_GUID`,
  `_FOLLOW_LINKS`, `_PATH` silently change output shape; the collector must clear them.
- **`zpool status -j`** nests vdevs as objects keyed by name with the root keyed by pool
  name. `--json-flat-vdevs` is easier. Numerics are strings unless `--json-int`. Real
  `zpool list -j` from mars (2.4.1) confirms the shape: `output_version`, `pools.<name>`
  with `pool_guid` as a decimal string, `properties.<prop>.{value,source}`.
- **Identity.** smartctl only reports WWN for ATA. The author's `vdev_id.conf` mixes
  `wwn-*` and `scsi-SATA_<model16>_<serial>` ids, where the model is truncated to 16
  chars by the INQUIRY product field. Same disk gets different by-id names depending on
  attachment. Match on any of WWN, `(model, serial)`, udev `ID_SERIAL`; key vdevs on
  `vdev_guid`.
- **Alias ↔ device.** `/run/udev/data/b<maj>:<min>` lists every udev property and
  symlink including `S:disk/by-vdev/K1`. One file read, no `/dev`, no root. Also
  `/dev/disk/by-vdev/`, `zpool status -P` + `-L` zipped positionally, and
  `vdev_id.conf` for aliases with no device present.
- **Events.** `zpool events` ring buffer is 512 entries, drops oldest, duplicate
  suppression for 15 min. Never a rate metric; `zpool status` counters are the truth.
  Lossless path is a ZED hook `all-diskbot.sh` posting `ZEVENT_*` env vars. `zpool
  history -i` is persisted in the pool and answers "when was K4 replaced".
- **Snapshots** listing is O(n) and can hammer ARC. Slow cadence, never on the request
  path.
- **`smartctl -n standby`** is mandatory on scheduled polls or 15 drives never sleep.
- **ZFS from a container** needs libzfs matching the kernel module. Options: host-side
  collector (recommended), `nsenter` with `pid: host` + privileged, bind-mount host
  binaries + libs, pin OpenZFS in image, SSH back. `/proc/spl/kstat/zfs:ro` is a free
  unprivileged mount for ARC stats.
- **Device passthrough without drift**: `volumes: /dev:/dev` + `device_cgroup_rules`
  (`b 8:* rmw`, `c 259:* rmw`, `c 10:* rmw`) + `cap_add: SYS_RAWIO` (+ `SYS_ADMIN` for
  NVMe). Scrutiny's docs only document the static list.
- The `vdev_id.conf` in the notes is stale; the one pasted into this session
  (K1–K6 as `wwn-*`, M1–M3 present) is current.
- A real `zpool events -v` capture from the Q2 failure (May 2025) exists in the author's
  notes: `vdev_path=/dev/disk/by-vdev/Q2-part1`, `parent_type=raidz`, hex-string
  numerics. First parser fixture.
- Aliases are per-cohort (letter = purchase batch, number = index), not physical bays.
  Physical location, if wanted later, comes from `vdev_enc_sysfs_path`.

## Sensitive data note

The scratchpad reports contain real serials, WWNs, a pool GUID and hostname. None are
reproduced in `docs/`. The project will be published: fixtures committed to the repo have
serials, WWNs and pool GUIDs scrubbed by the capture script (consistent fake values that
keep format and length, so alias matching still works).
