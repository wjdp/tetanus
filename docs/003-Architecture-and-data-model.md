---
type: reference
---

# Architecture and data model

Design baseline for diskbot. Living document; update as decisions land. Background in
[002](002-Prior-art-and-problem-space.md), goals in [001](001-Product-goals.md).

## Shape

One Nuxt 4 app in one container, as grate. Two things differ from grate:

1. **Data comes from the host**, not from HTTP APIs. `smartctl`, `zpool`, `zfs`, udev,
   `vdev_id.conf`.
2. **The collector may live outside the container.** ZFS userland must match the kernel
   module, which a portable image can't promise. So the app never assumes it can run
   `zpool` itself.

### The ingest seam

Scrutiny got one thing right: the collector is dumb, the server does all parsing. Copy
that and go further: the collector ships **raw command output**, the server parses.

```
POST /api/ingest/:source            body: raw stdout of the command, text/plain
  ?device=/dev/sdc&type=sat         (smartctl sources)
  ?exitStatus=64                    (smartctl bitmask; non-zero is data, not failure)
```

Sources (v1):

| source | command |
| --- | --- |
| `smartctl-scan` | `smartctl --scan --json` |
| `smartctl-xall` | `smartctl --xall --json -n standby [-d type] <dev>` |
| `zpool-status` | `zpool status -j --json-flat-vdevs --json-int -Ppvs` (no `-L`: it resolves `by-vdev` paths to `/dev/sdX` and drops `guid`, `path`, `devid`, `state` from leaf vdevs; verified on OpenZFS 2.4.1) |
| `zpool-list` | `zpool list -j --json-int -pv` |
| `zpool-iostat` | `zpool iostat -vpl 1 2` |
| `zfs-list` | `zfs list -j --json-int -p -t filesystem,volume -o <cols>` |
| `zfs-snapshots` | `zfs list -j --json-int -p -t snapshot -o name,used,referenced,written,creation -s creation` |
| `zpool-history` | `zpool history -il` |
| `zpool-events` | `zpool events -vH` (poll) or ZED hook env (push) |
| `vdev-id-conf` | `cat /etc/zfs/vdev_id.conf` |
| `lsblk` | `lsblk -J -b -o NAME,TYPE,SIZE,MODEL,SERIAL,WWN,TRAN,ROTA,MAJ:MIN` |
| `udev` | `cat /run/udev/data/b<maj>:<min>` per disk |

Every source has one parser in `server/ingest/<source>.ts`, pure text → typed object,
tested against fixtures. The server never cares who ran the command. Minimum host is
OpenZFS 2.3+ so ZFS parsers consume `-j` JSON only; `zpool iostat` is the one text
parser. Check `output_version.vers_major` on every ZFS payload.

Three producers can feed the seam:

- **Host script** (default). One bash script, curl only, no jq, no node: runs every
  source in the table on a systemd timer and POSTs. Plus a ZED hook `all-<name>.sh`
  posting `ZEVENT_*` for lossless events. Decided 2026-09-28: this is the primary
  producer for **all** sources, SMART included, so the container needs no device access,
  no capabilities, no `/dev`. Kept minimal: no config beyond the app URL and an optional
  token.
- **In-container exec**: Nitro task runs the same commands via `execFile`. Kept as an
  optional mode for SMART, udev and vdev_id.conf only (static smartmontools in image,
  `/dev` bind-mounted, cgroup rules), for users who won't install anything on the host.
  Never for `zfs`.
- **Scrutiny collector**: its two POST routes are a thin adapter onto `smartctl-scan`
  and `smartctl-xall`. Optional, cheap to add later.

Cadence lives in the host timer for ZFS and SMART; the app records what it receives and
banners on silence. A "collect now" button is not possible in host mode without a
callback; accept that, or later add a long-poll the script honours.

Each source records a `CollectorRun` (started, finished, ok, error, producer). Missing
runs beyond the expected cadence raise a fault banner: "no ZFS data for 3 h".

Mode is per source, in settings: `remote | local | off`. Default remote for everything.
First-run setup page shows what has been received and what hasn't.

### Compose sketch

```yaml
services:
  diskbot:
    image: wjdp/diskbot
    user: "1000:1000"          # + disk group gid for /dev access if local SMART
    ports: ["3000:3000"]
    volumes:
      - ./data:/app/data
    environment: { TZ: Europe/London }
```

That's the whole container in host-collector mode. Only if local SMART mode is enabled:
add `/dev:/dev:ro`, `/run/udev:/run/udev:ro`, `/etc/zfs/vdev_id.conf:ro`,
`device_cgroup_rules` (`b 8:* rmw`, `c 259:* rmw`) and `cap_add: [SYS_RAWIO]`
(+ `SYS_ADMIN` for NVMe). No static device list, ever.

Host side: `/usr/local/bin/<name>-collect`, `<name>-collect.timer`, `zed.d/all-<name>.sh`.
Installer script in the repo; documented, not automated over SSH. The ingest route
accepts an optional bearer token for people who put the app on a non-loopback port.

The project name is provisional. It appears in exactly one constant
(`shared/app.ts`), and the host script, unit and hook names are derived from it at
build time.

## Identity

Never `/dev/sdX`. Never a single key.

```ts
type DiskKey =
  | { kind: "wwn"; value: string }          // lowercase, no 0x. ATA from smartctl; others from udev ID_WWN / sysfs wwid
  | { kind: "model-serial"; value: string } // normalised: upper, strip WD- prefix, strip INQUIRY 16-char truncation, collapse _/space
  | { kind: "udev-serial"; value: string }  // ID_SERIAL
  | { kind: "by-id"; value: string }        // every /dev/disk/by-id name seen
```

Matching: an observation matches an existing `Disk` if **any** key matches. Merge new
keys onto it. If keys match two different disks, don't merge; create a
`identity-conflict` diary entry and show a banner. Also compute scrutiny's UUIDv5 over
`model + serial + wwn` and store it: the importer joins on it.

ZFS: vdevs keyed on `vdev_guid`. `path`, `devid`, `phys_path` are display and
correlation only.

Alias ↔ disk: from udev `S:disk/by-vdev/<alias>` on the live device, from
`zpool status -P` paths, and from `vdev_id.conf` targets resolved through by-id keys.
Alias is stored on `Disk`, unique. When `vdev_id.conf` disagrees with the stored alias,
show drift, don't overwrite.

## Disk state

```
inferred =
  vdev present and pool member            → in-use     (with zfs state: online|degraded|faulted|offline|unavail|removed)
  device present, no pool membership      → spare
  device absent, seen within N days       → missing    (N default 7)
  device absent, not seen for N days      → removed
  never seen (inventory-only row)         → unseen
override ∈ { none, spare, removed, dead, sold, retired }
effective = override ?? inferred
```

`missing` alerts once; `removed` is quiet. Override is manual and produces a diary
entry. Transitions of `effective` produce diary entries.

## SMART evaluation

Port scrutiny's algorithm ([002](002-Prior-art-and-problem-space.md) §Evaluation logic)
with the SCSI lookup bug fixed. Vendored `shared/smart/metadata.json` with a `bin/`
generator that rebuilds it from a scrutiny checkout. Transforms for 188 and 194 in TS.

Per attribute per reading: `status ∈ passed | warning | failed`, `failureRate`,
`transformedValue`. Single threshold policy used for dashboard **and** alerts (fixing
scrutiny's split).

Overlay, computed on read:

- **Accepted**: a `FaultAcceptance(disk, attr, acceptedValue)` exists and current
  `transformedValue <= acceptedValue` → display `accepted`, no alert. Value rises →
  back to `failed`, alert fires, acceptance marked `superseded`, diary entry.
- **Trend**: for each non-passed attribute, compare current value with 7 d and 30 d ago.
  `stable | worsening | new`. Shown next to status; feeds the accept dialog ("16 for 14
  months, stable").

Disk status = worst of un-accepted attribute statuses, plus `smart_status.passed`.

Raw smartctl JSON is stored **only for the latest reading per disk** (`Disk.latestRaw`).
Hourly raw would be ~10 GB/yr; normalised attribute rows are ~7 M rows/yr and fine.

Temperature: `TemperatureReading` unique on `(disk, at)`, backfilled from SCT history
with interval-aligned timestamps (scrutiny's trick) so it's idempotent.

## Data model

Drizzle, SQLite, grate helpers (`autoIncrementId`, `datetime`, `boolean`, `json`).
Table names PascalCase for consistency with grate. Sketch, not schema:

```
Disk            id, alias?, scrutinyUuid, model, modelFull, serial, firmware, capacityBytes,
                rotationRate, protocol (ata|nvme|scsi), transport, formFactor,
                firstSeenAt, lastSeenAt, lastDevicePath, lastDeviceType,
                stateOverride?, notes (md), inventory (json, see below), latestRaw (json),
                latestStatus, latestTemp, latestPowerOnHours, latestPowerCycles
DiskKey         diskId, kind, value            unique(kind, value)
SmartReading    id, diskId, takenAt, devicePath, deviceType, smartPassed, exitStatus,
                temp, powerOnHours, powerCycles, deviceStatus
SmartAttribute  readingId, attrId (text: "5" | "media_errors"), value, worst, thresh,
                rawValue, rawString, whenFailed, transformedValue, status, failureRate
                index(diskId via reading, attrId, takenAt)
TemperatureReading  diskId, at, celsius       unique(diskId, at)
SelfTest        diskId, type, status, lifetimeHours, lba?, seenAt   unique per (disk, lifetimeHours, type)
FaultAcceptance id, diskId, attrId, acceptedValue, acceptedAt, note, supersededAt?
Pool            id, guid, name, state, health, sizeBytes, allocBytes, freeBytes, frag, cap,
                dedup, scan (json: type, state, started, finished, examined, errors),
                firstSeenAt, lastSeenAt
Vdev            id, poolId, guid, parentId?, name, type (root|raidz1|raidz2|mirror|disk|special|log|cache|spare|indirect),
                state, readErrors, writeErrors, cksumErrors, slowIos, path?, devid?,
                diskId?, sizeBytes?, allocBytes?, frag?, lastSeenAt
PoolReading     poolId, at, alloc, free, frag, cap, state
VdevReading     vdevId, at, readErrors, writeErrors, cksumErrors, slowIos, state, alloc?, frag?
Dataset         id, poolId, name, type, used, referenced, available, logicalUsed,
                compressRatio, usedBySnapshots, mountpoint, quota, creation, lastSeenAt
Snapshot        id, datasetId, name, used, referenced, written, creation, lastSeenAt
ZfsEvent        eid, at, class, poolGuid?, vdevGuid?, payload (json)      unique(eid, at)
PoolHistory     poolId, at, internal, text                                unique(poolId, at, text)
DiaryEntry      id, subjectType (disk|pool|vdev|system), subjectId, at, kind (manual|auto),
                eventType?, title, body (md), data (json)
Notification    id, at, channel, dedupeKey, subject, ok, error?
CollectorRun    id, source, producer, startedAt, finishedAt, ok, error?, bytes
Setting         single row: thresholds, cadences, notification config, source modes
```

### Inventory fields

Human-entered metadata is a registry, not columns, so adding a field is one line:

```ts
// shared/inventory-fields.ts
export const INVENTORY_FIELDS = [
  { key: "purchaseDate",      label: "Purchased",   type: "date" },
  { key: "purchasePrice",     label: "Price",       type: "money" },
  { key: "supplier",          label: "Supplier",    type: "text" },
  { key: "purchaseCondition", label: "Condition",   type: "enum", values: ["new", "used", "refurbished", "shucked"] },
  { key: "warrantyExpiry",    label: "Warranty",    type: "date" },
  { key: "pin33Taped",        label: "3.3 V pin",   type: "boolean" },
] as const;
```

The registry generates the zod schema for `PATCH /api/disks/:id`, the edit form, the
inventory table columns and the importer's column mapping. Values live in
`Disk.inventory` JSON; sort and filter via `json_extract`. Computed columns (age,
warranty remaining) are derived in the service from registry keys. `alias` and `notes`
stay real columns because everything joins on them.

Retention: keep everything in v1; schema leaves `SmartAttribute` easy to downsample by
`DELETE ... WHERE takenAt < x AND takenAt NOT IN (daily last)` later.

## Services

Plain functions over `db`, as grate. Pure derivation separated from IO.

- `ingest/*` parsers (pure).
- `identity` match/merge (pure over key sets).
- `disks` registry, state inference, inventory edits.
- `smart` evaluation (pure), reading persistence, trend, acceptance overlay.
- `zfs` topology upsert, dataset/snapshot upsert, events, history.
- `diary` entries; auto-event emitters called by the above.
- `alerts` rule evaluation after each ingest, dedupe, dispatch (pushover, webhook,
  healthchecks ping on a timer).
- `importers/scrutiny`, `importers/obsidian`.
- `vdevIdConf` parse + render proposal.

Tasks (Nitro, grate queue): `collect:<source>` for local sources on cron;
`evaluate:disk` after any SMART ingest; `evaluate:zfs` after ZFS ingest; `alerts:tick`;
`healthcheck:ping`.

## API

`/api/ingest/:source` (POST, text). `/api/disks`, `/api/disks/:id` (+ PATCH inventory),
`/api/disks/:id/smart?range=`, `/api/disks/:id/accept` (POST/DELETE),
`/api/pools`, `/api/pools/:id`, `/api/datasets`, `/api/datasets/:id/snapshots`,
`/api/diary` (+ POST), `/api/alerts`, `/api/settings`, `/api/health`, `/api/sse`,
`/api/vdev-id-conf` (GET rendered proposal), `/api/import/scrutiny`,
`/api/import/obsidian`.

Zod schemas in `shared/schemas/`. SMART metadata served once at `/api/smart/metadata`
and cached, or bundled.

## UI

- **Home: topology.** Pools → vdevs → disks as a grid of tiles by alias, coloured by
  effective status. Side rail for spares, missing, removed. Header bar: collector
  health, last collection time, active scan/resilver.
- **Disk page.** Nameplate + inventory (editable), status with accept controls,
  attribute table (scrutiny's layout: status, id, name, value, thresh, ideal, failure
  rate, sparkline, expandable explanation), trend chips, temperature and selected
  attribute charts, self-tests, diary for this disk, ZFS membership.
- **Inventory.** The Obsidian table, live. Sortable, filter by state/pool/cohort.
  Age (calendar + power-on), warranty remaining, 3.3 V pin.
- **ZFS.** Pool detail with capacity/frag history and scan history; dataset tree with
  usage; snapshot list per dataset.
- **Diary.** Global timeline, filter by subject/kind.
- **Settings.** Sources and modes, cadences, thresholds, notification channels,
  healthchecks URL, vdev_id.conf proposal, importers.
- Fault banners in layout for collector silence, identity conflicts, vdev_id drift.
- Command palette: jump to disk/pool by alias or serial.

Charts: library undecided. Sparklines in tables as inline SVG regardless.
