---
type: reference
---

# Architecture and data model

Design baseline for tetanus. Living document; update as decisions land. Background in
[002](002-Prior-art-and-problem-space.md), goals in [001](001-Product-goals.md).

## Shape

One Nuxt 4 app in one container, as grate. Two things differ from grate:

1. **Data comes from the host**, not from HTTP APIs. `smartctl`, `zpool`, `zfs`, udev,
   `vdev_id.conf`.
2. **The collector lives outside the container.** ZFS userland must match the kernel
   module, which a portable image can't promise. So the app never runs `zpool`, or any
   other host command, itself.

### Hosts

One server, many hosts. Each host runs the collector and POSTs to the server; the
container only ingests and processes. A host's identity is its short hostname at
enrolment; a display name can be set in the UI afterwards. Pools, SMART readings and
collector runs belong to a host. Disks don't: they move between hosts, so a disk records
only the host it was last seen on.

### The ingest seam

Scrutiny got one thing right: the collector is dumb, the server does all parsing. Copy
that and go further: the collector ships **raw command output**, the server parses.

```
POST /api/ingest/:source            body: raw stdout of the command, text/plain
  Authorization: Bearer <enrol token>
  Tetanus-Host: <hostname -s>
  ?device=/dev/sdc&type=sat         (smartctl sources)
  ?exitStatus=64                    (smartctl bitmask; non-zero is data, not failure)
```

The enrol token is server-wide, generated on first boot and shown on the first-run and
settings pages. Wrong or missing token → 401. An unknown host name creates a `Host` row
on first POST. Each POST is recorded as a `CollectorRun` with its `hostId`. The header
name is derived from the app-name constant like the script and unit names, with no `X-`
prefix (RFC 6648).

Pool GUIDs are global: a pool exported from one host and imported on another is the same
`Pool` row with `hostId` moved. Event ids (`eid`) are per host. ZED posts arrive
concurrently and out of order, so only a `zpool-events` dump (the whole ring buffer) is
checked for an eid reset or a gap ([077](077-Out-of-order-ZED-events-trigger-false-gaps-and-resets.md)).
An archived pool
(`Pool.archivedAt`, [047](047-Archive-pools.md)) keeps ingesting quietly but is hidden
from lists, raises no faults and sends no alerts; seeing it again does not unarchive it.

Sources (v1):

| source | command |
| --- | --- |
| `versions` | `KEY=value` lines: `zfs`, `zpool`, `kernel`, `smartctl`, `os` |
| `smartctl-scan` | `smartctl --scan --json` |
| `smartctl-xall` | `smartctl --xall --json -n standby [-d type] <dev>` |
| `lsblk` | `lsblk -J -b -o NAME,TYPE,SIZE,MODEL,SERIAL,WWN,TRAN,ROTA,MAJ:MIN,PATH,PTTYPE,PARTUUID,FSTYPE` |
| `udev` | `cat /run/udev/data/b<maj>:<min>` per disk |
| `enclosure` | `<path>\t<value>` per SES file under `/sys/class/enclosure`: enclosure `id`, `components`, `device/{vendor,model}`; per slot `slot`, `status`, `locate`, `fault`, `device/block/*/dev` ([061](061-Physical-bay-mapping.md)) |
| `vdev-id-conf` | `cat /etc/zfs/vdev_id.conf` |
| `zpool-status` | `zpool status -j --json-flat-vdevs --json-int -Ppvs` (no `-L`: it resolves `by-vdev` paths to `/dev/sdX` and drops `guid`, `path`, `devid`, `state` from leaf vdevs; verified on OpenZFS 2.4.1) |
| `zpool-list` | `zpool list -j --json-int -pv` |
| `zfs-list` | `zfs list -j --json-int -p -t filesystem,volume -o <cols>` |
| `zfs-snapshots` | `zfs list -j -p -t snapshot -o name,guid,used,referenced,written,creation -s creation` (no `--json-int`: it saturates u64 guids at INT64_MAX; values arrive as strings) |
| `zpool-history` | per pool from `zpool list -H -o name`: `History for '<pool>':` then `TZ=UTC zpool history -il <pool> \| tail -n 500` |
| `zfs-receives` | as `zpool-history`, piped through `grep -E 'finish receiving \|zfs (recv\|receive) ' \| tail -n 2000` instead of the tail ([015](015-Replication-health.md)) |
| `zpool-events` | `zpool events -vH` (poll) |
| `zed-event` | ZED hook posts `KEY=value` lines for every `ZEVENT_*` env var (push) |

Planned after v1, same seam: `zfs-get` and `zpool-get` ([024](024-ZFS-property-audit.md),
[015](015-Replication-health.md)), `kernel-log` ([022](022-Kernel-log-ingest.md)),
`diskstats` ([023](023-Disk-stats-ingest.md)), `job-report` for non-ZFS backup scripts
([015](015-Replication-health.md)). `zfs-snapshots` gains `guid` in Phase 9.

Every source has one parser in `server/ingest/<source>.ts`, pure text → typed object,
tested against fixtures. The server never cares who ran the command. Minimum host is
OpenZFS 2.3+ so ZFS parsers consume `-j` JSON wherever it exists; the ZFS text parsers
are `zpool-history`, `zpool-events` and `zed-event`. Check `output_version.vers_major` on every ZFS payload.

A command that exits non-zero with no stdout is reported, not dropped: the collector
POSTs the tail of its stderr to the same source with `?failed=<exit status>`, and the
server records a failed `CollectorRun` (`ok` false, `exitStatus`, `error` "Command
exited N: <stderr>") without parsing, answering 200. Older tool versions show as a
`host-degraded` fault ([079](079-Unsupported-OpenZFS-fails-silently.md)).

Producers:

- **Host script** (default). One bash script, curl only, no jq, no node: runs every
  source in the table on a systemd timer and POSTs. Plus a ZED hook `all-<name>.sh`
  posting `ZEVENT_*` for lossless events. The only producer in v1, for **all** sources,
  SMART included, so the container needs no device access, no capabilities, no `/dev`.
  Kept minimal: no config beyond the server URL and enrol token.
- **Scrutiny collector** (later): its two POST routes are a thin adapter onto
  `smartctl-scan` and `smartctl-xall`, with the host header mapped from its config.

An in-container producer (`execFile` for SMART, udev and vdev_id.conf; static
smartmontools, `/dev` bind-mounted) is deferred past v1. Never for `zfs`.

Cadence lives in the host timer for ZFS and SMART; the app records what it receives and
banners on silence. A "collect now" button is not possible without a callback;
accept that, or later add a long-poll the script honours.

Each source records a `CollectorRun` (host, started, finished, ok, error, producer).
When every source group is past twice its cadence the host gets a `collector-silent`
fault ([036](036-Faults-page.md)), shown in the banner strip: "No data for 3 h".

First-run page shows the enrol token, the collector install one-liner, and which hosts
and sources have reported.

### Compose sketch

```yaml
services:
  tetanus:
    image: ghcr.io/wjdp/tetanus
    user: "1000:1000"
    ports: ["3000:3000"]
    volumes:
      - ./data:/app/data
    environment: { TZ: Europe/London }
```

That's the whole container: no devices, no capabilities, no smartmontools. No static
device list, ever.

Host side, on each host: `/usr/local/bin/<name>-collect`, `<name>-collect.timer`,
`zed.d/all-<name>.sh`. Installer script in the repo takes the server URL and enrol
token; documented, not automated over SSH.

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
Alias is stored on `Disk`, unique across all hosts: the cohort scheme is global and disks
move between hosts. When `vdev_id.conf` disagrees with the stored alias, show drift,
don't overwrite.

Disk ↔ host: `Disk.lastSeenHostId` only, no membership table. A disk seen on a
different host gets a diary auto event ("moved from mars to X").

## Disk state

```
inferred =
  vdev present and pool member            → in-use     (with zfs state: online|degraded|faulted|offline|unavail|removed)
  device present, no pool membership      → spare
  device absent, seen within N days       → missing    (N default 7)
  device absent, not seen for N days      → removed
  never seen (inventory-only row)         → unseen
override ∈ { none, spare, removed, dead, retired }
effective = override ?? inferred
```

"Absent" means absent from the host's latest `lsblk` / `smartctl-scan`: state is judged
as of that scan, so a host that stops reporting leaves its disks as they were and faults
itself (`collector-silent`) instead
([045](045-Silent-host-does-not-make-its-disks-missing.md)).

`missing` alerts once; `removed` is quiet. Override is manual and produces a diary
entry. Transitions of `effective` produce diary entries.

Disposal is separate from state ([040](040-Disk-disposal.md)): `Disk.disposal`
(`{ kind: sold | rma | recycled | given-away, on, salePrice? }`, null while owned) says
the disk has left your possession. Only an absent disk can be disposed. While disposed,
transitions are frozen (no `state-changed` entries), and faults, alert rules, sidebar
counts, Topology and the Disks list (unless `disposed=1`) leave the disk out; the disk
page and search still show it. A sighting of a disposed disk writes one
`disposed-disk-seen` diary entry per disposal, which alerts. `Disk.replacesDiskId`
links an RMA replacement to the RMA'd disk it replaces (one replacement each); diary
entries `replaced-by` / `replaces` / `replacement-cleared` record the link.

## SMART evaluation

Port scrutiny's algorithm ([002](002-Prior-art-and-problem-space.md) §Evaluation logic)
with the SCSI lookup bug fixed. Vendored `shared/smart/metadata.json` with a `bin/`
generator that rebuilds it from a scrutiny checkout. A tetanus classification layer sits
on top ([027](027-SMART-status-classification.md)): `shared/smart/classification.ts`
splits ATA attributes into `defect` (5, 10, 184, 187, 188, 196, 197, 198, 201) and
`context` (everything else). Backblaze failure rates change status only for defect
attributes; context rates are shown as information. Values above the top bucket use it;
a value with no bucket leaves status alone. Manufacturer `when_failed` applies to all.

`transformedValue` is the leading integer of smartctl's `raw.string`, which already
carries the drivedb-decoded rendering (Seagate `0/137774677`, WD `398 (Average 396)`),
falling back to `raw.value`; 188 keeps its three-word parser.

Per attribute per reading: `status ∈ passed | warning | failed`, `failureRate`,
`transformedValue`. Single threshold policy used for dashboard **and** alerts (fixing
scrutiny's split). `SMART_POLICY_VERSION` is compared with
`Settings.config.smartPolicyVersion` at boot; on mismatch every disk's latest reading is
re-evaluated from its stored rows and disk statuses recomputed, with `smart-status-changed`
diary entries but no attribute alerts.

Overlay, computed on read:

- **Accepted**: a `FaultAcceptance(disk, attr, kind = accept, acceptedValue)` exists and
  current `transformedValue <= acceptedValue` → display `accepted`, no alert. Value rises →
  back to `failed`, alert fires, acceptance marked `superseded`, diary entry.
- **Acknowledged**: the same with `kind = acknowledge` → display `acknowledged`; the
  attribute still counts towards disk status, but as `warning` at most. Superseded by
  the same rule ([042](042-Acknowledge-faults.md)).
- **Trend**: for each non-passed attribute, compare current value with 7 d and 30 d ago.
  `stable | worsening | new`. Shown next to status; feeds the accept dialog ("16 for 14
  months, stable").

Disk status = worst of un-accepted attribute statuses (acknowledged capped at `warning`),
plus `smart_status.passed`.

Raw smartctl JSON is stored **only for the latest reading per disk** (`Disk.latestRaw`).
Hourly raw would be ~10 GB/yr; normalised attribute rows are ~7 M rows/yr and fine.

Temperature: `TemperatureReading` unique on `(disk, at)`, backfilled from SCT history
with interval-aligned timestamps (scrutiny's trick) so it's idempotent.

## Data model

Drizzle, SQLite, grate helpers (`autoIncrementId`, `datetime`, `boolean`, `json`).
Table names PascalCase for consistency with grate. Sketch, not schema:

```
Host            id, name (unique, hostname -s), displayName?, toolVersions (json),
                healthchecksUrl?, notes, firstSeenAt, lastSeenAt
Disk            id, alias? (unique), scrutinyUuid, model, modelFull, serial, firmware, capacityBytes,
                rotationRate, protocol (ata|nvme|scsi), transport, formFactor,
                firstSeenAt, lastSeenAt, lastSeenHostId, lastDevicePath, lastDeviceType,
                stateOverride?, disposal? (json), replacesDiskId? (→ Disk, unique),
                notes (md), inventory (json, see below), latestRaw (json),
                latestStatus, latestTemp, latestPowerOnHours, latestPowerCycles,
                ataSsdAttributes? (json: { wear: attrId?, written: { attrId, unitBytes,
                inferred }? }, SATA SSD attribute ids by smartctl name, set at ingest)
DiskKey         diskId, kind, value            unique(kind, value)
SmartReading    id, diskId, hostId, takenAt, devicePath, deviceType, smartPassed, exitStatus,
                temp, powerOnHours, powerCycles, deviceStatus
SmartAttribute  readingId, attrId (text: "5" | "media_errors"), value, worst, thresh,
                rawValue, rawString, whenFailed, transformedValue, status, failureRate
                index(diskId via reading, attrId, takenAt)
TemperatureReading  diskId, at, celsius       unique(diskId, at)
SelfTest        diskId, type, status, lifetimeHours, lba?, seenAt   unique per (disk, lifetimeHours, type)
FaultAcceptance id, diskId, attrId, kind (accept | acknowledge), acceptedValue, acceptedAt, note, supersededAt?
Fault           id, kind, category (disk|zfs|host), subjectType (disk|pool|host), subjectId, key,
                severity (warning|error), data (json), openedAt, lastSeenAt, resolvedAt?,
                state (open|acknowledged|accepted|resolved), stateChangedAt, note
                unique(kind, key) where resolvedAt is null; see 036
Pool            id, hostId (current), guid (unique), name, state, status?, action?, msgid?, moreinfo?, health,
                errors?, damagedFiles? (json), damagedFilesError?, sizeBytes, allocBytes, freeBytes, frag, cap,
                dedup, scan (json: type, state, started, finished, examined, issued, pausedAt, errors),
                scanProgressAt?, lastScrub? (json), removal? (json), config? (json: scrubIntervalDays,
                slowIoThreshold), firstSeenAt, lastSeenAt, archivedAt?, archiveNote; see 046, 047
Vdev            id, poolId, guid, parentId?, name, type (root|raidz1|raidz2|draid1-3|mirror|disk|file|dspare|special|log|cache|spare|indirect),
                role (normal|log|cache|special|dedup|spare), state, spareState?, readErrors, writeErrors,
                cksumErrors, slowIos, path?, devid?, physPath?, diskId?, sizeBytes?, allocBytes?, frag?,
                present, lastSeenAt
PoolReading     poolId, at, alloc, free, frag, cap, state
VdevReading     vdevId, at, readErrors, writeErrors, cksumErrors, slowIos, state, alloc?, frag?
Dataset         id, poolId, name, type, used, referenced, available, logicalUsed,
                compressRatio, usedBySnapshots, mountpoint, quota, creation, lastSeenAt
Snapshot        id, datasetId, name, used, referenced, written, creation, lastSeenAt
ZfsEvent        hostId, eid, at, class, poolGuid?, vdevGuid?, payload (json)   unique(hostId, eid)
PoolHistory     poolId, at, internal, text                                unique(poolId, at, text)
DiaryEntry      id, subjectType (disk|pool|vdev|host|system), subjectId, at, kind (manual|auto),
                eventType?, title, body (md), data (json)
Notification    id, at, channel, dedupeKey, subject, ok, error?
CollectorRun    id, hostId, source, device?, deviceType?, exitStatus?, receivedAt, ok, error?, bytes, producer?
Payload         id, hostId, source, device ('' when none), receivedAt, body   unique(hostId, source, device)
Setting         single row: enrolToken, thresholds, cadences, notification config
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

The registry generates the zod schema for `PATCH /api/disks/:id`, the inline fields
on the disk page (each field's `group` places it there), the
inventory table columns and the importer's column mapping. Values live in
`Disk.inventory` JSON; sort and filter via `json_extract`. Computed columns (age,
warranty remaining) are derived in the service from registry keys. `alias` and `notes`
stay real columns because everything joins on them.

Retention: keep everything in v1; schema leaves `SmartAttribute` easy to downsample by
`DELETE ... WHERE takenAt < x AND takenAt NOT IN (daily last)` later.

## Services

Plain functions over `db`, as grate. Pure derivation separated from IO.

- `ingest/*` parsers (pure).
- `hosts` token check, upsert on ingest, freshness per source.
- `identity` match/merge (pure over key sets).
- `disks` registry, state inference, inventory edits.
- `smart` evaluation (pure), reading persistence, trend, acceptance overlay.
- `zfs` topology upsert, dataset/snapshot upsert, events, history.
- `diary` entries; auto-event emitters called by the above.
- `alerts` rule evaluation after each ingest, dedupe, dispatch (pushover, webhook).
  Subjects carry the host name ("mars: pool tank DEGRADED"). Healthchecks ping per host
  on a timer, succeeding only if that host's sources are fresh.
- `importers/scrutiny` (into a chosen target host).
- `vdevIdConf` parse + render proposal.

Tasks (Nitro, grate queue): `evaluate:disk` after any SMART ingest; `evaluate:zfs` after ZFS ingest; `alerts:tick`;
`healthcheck:ping`.

## API

`/api/ingest/:source` (POST, text, bearer). `/api/hosts`, `/api/hosts/:id` (+ PATCH).
`/api/disks`, `/api/disks/:id` (+ PATCH inventory),
`/api/disks/:id/smart?range=`, `/api/disks/:id/accept` (POST/DELETE),
`/api/pools`, `/api/pools/:id`, `/api/datasets`, `/api/datasets/:id/snapshots`,
`/api/diary` (+ POST), `/api/alerts`, `/api/settings`, `/health`, `/api/sse`,
`/api/vdev-id-conf` (GET rendered proposal), `/api/import/scrutiny`.

Zod schemas in `shared/schemas/`. SMART metadata served once at `/api/smart/metadata`
and cached, or bundled.

## UI

- **Home: topology.** Grouped by host, then pools → vdevs → disks as a grid of tiles by
  alias, coloured by effective status. Side rail for spares, missing, removed. Header
  bar: collector health and last collection time per host, active scan/resilver.
- **Disk page.** Header: inline-edited alias, model and serial, then a status strip
  (SMART status, lifecycle menu, usage and purpose, pool breadcrumb, fault counts) and
  one actions menu (diagnostics, dispose). Tabs in `?tab=`: Overview (Identity,
  Hardware with dataset specs, Placement, Health, Ownership, Notes; inventory edited
  inline per field, saving on commit), SMART (status with accept controls, attribute
  table in scrutiny's layout, temperature chart, self-tests) and Diary (loaded on
  first open, paged). See [066](066-Disk-page-redesign.md).
- **Inventory.** The Obsidian table, live. Sortable, filter by host/state/pool/cohort;
  host column (last seen).
  Age (calendar + power-on), warranty remaining, 3.3 V pin.
- **ZFS.** Pool detail with capacity/frag history and scan history; dataset tree with
  usage; snapshot list per dataset.
- **Diary.** Global timeline, filter by subject/kind.
- **Settings.** Enrol token and install one-liner; Hosts page (rename, healthchecks
  URL, last seen per source); cadences, thresholds, notification channels,
  vdev_id.conf proposal, importers.
- Faults page and banner strip ([036](036-Faults-page.md)): stored occurrences synced
  by the alerts pass; the banner shows open errors, capped at three.
- Command palette: jump to disk/pool by alias or serial.

Charts: library undecided. Sparklines in tables as inline SVG regardless.
