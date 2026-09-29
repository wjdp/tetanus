---
type: task
status: done
---

# Disk diagnostics export

A "Download diagnostics" button on the disk page that zips everything tetanus knows
about a disk, plus the raw collector output behind it, so a user can attach it to a bug
report and a maintainer can replay it in a test. Spec'd 2026-09-29 after debugging
disk 30 (a Pi SD card whose lsblk entry never matched) straight from the dev DB.

Decided 2026-09-29: zip in fixture layout, no redaction, disk only (host bundle
later), 30 days of readings.

## Why whole host payloads

Disk 30's bug was a payload that failed to attach to the disk. An export of only what
is linked to the disk would have omitted the evidence. So the bundle carries the host's
latest disk-source payloads in full, not filtered to the disk.

`Payload` keeps only the latest body per (host, source, device); raw history does not
exist, so the bundle has the current raw output only.

## Contract

### Route

`GET /api/disks/:id/diagnostics` → `application/zip`,
`Content-Disposition: attachment; filename="tetanus-disk-<id>-<yyyy-mm-dd>.zip"`.
Service `buildDiskDiagnostics(id, now)` in `server/services/diagnostics.ts` returns
`Record<path, string>`; the route zips with `fflate` (`zipSync`, new dependency). 404 via
`ServiceError` for an unknown disk.

### Layout

```
tetanus-disk-30-2026-09-29/
  README.md                 what this is, generated-at, how to replay
  meta.json                 app version, latest migration tag, settings (missingAfterDays,
                            SMART policy), now
  db/
    disk.json               Disk row (all columns, raw JSON columns parsed)
    keys.json               DiskKey rows
    summary.json            getDisk() output: effective state, usage, purpose, as the UI sees it
    diary.json              all diary entries for the disk
    smart-readings.json     last 30 days
    smart-attributes.json   last 30 days
    temperatures.json       last 30 days
    self-tests.json         all
    acceptances.json        fault acceptances
    membership.json         vdev rows naming the disk, with pool name and state
    host.json               last-seen host row (tool versions, collector version)
    collector-runs.json     host's CollectorRun rows for disk sources, last 30 days
  raw/<host>/               latest payloads, fixture naming (test/fixtures/mars)
    lsblk.json
    smartctl-scan.json
    versions.txt
    smartctl/xall-<dev>[-<type>].json   one per device payload on the host
    udev/<device, : as ->.txt           one per device payload on the host
    zpool-status.json
    vdev-id-conf.txt
    *.exit                        exit status from the matching CollectorRun
    manifest.json                 per file: source, device, type, exit status, receivedAt
```

Disk sources: `lsblk`, `udev`, `smartctl-scan`, `smartctl-xall`, `zpool-status`,
`vdev-id-conf`. Every device payload of those sources on the host is included, not just
this disk's. Bodies are written byte for byte; never reformatted.

A disk with no `lastSeenHostId` (inventory-only, scrutiny import) gets `db/` only and a
README line saying so.

### Replay

`test/diagnostics.ts` exports `replayBundle(dir)`: ingests `raw/<host>/` into the
per-file `:memory:` DB in the collector's order (versions, lsblk, udev,
smartctl-scan, smartctl-xall, zpool-status, vdev-id-conf) through the same ingest
service the route uses. A maintainer unzips into `test/fixtures/bugs/<name>/`, calls
`replayBundle`, and asserts on the disk. The README points at this.

### UI

Disk page header actions: "Download diagnostics" (`i-lucide-file-archive`), plain
`<a href download>` to the route. Tooltip: "Includes serials, hostnames and mount
paths. Check before posting publicly."

### As built

- `manifest.json` added: `Payload` keeps no device type, and file names cannot
  round-trip device paths, so replay reads meta from the manifest (type and exit from the
  `CollectorRun` matching the payload's `receivedAt`).
- `versions` payload included so replay sets tool versions.
- `db/host.json` omits `healthchecksUrl` (a credential, not evidence); `meta.json`
  settings are `missingAfterDays` and `smartPolicyVersion` only.
- Disk 30 root cause: lsblk reports a model-less, WWN-less `mmcblk0` whose serial is
  udev's `ID_SERIAL`, so it yielded no keys. lsblk now keys such disks as `udev-serial`.
  Regression: `server/services/disks.test.ts` "Pi SD card bundle".

## Order

1. `buildDiskDiagnostics` + tests over the mars fixtures (paths present, bodies
   byte-identical, 30-day cut-off, inventory-only disk).
2. Route + `fflate`; e2e test: 200, zip content type, unzips to the expected paths.
3. `replayBundle` + a test that round-trips: ingest mars, export a disk, replay into a
   fresh DB, same `getDisk` summary.
4. Disk page button.
5. First real use: capture disk 30 from the dev DB as `test/fixtures/bugs/pi-sd-card/`
   for the MMC matching fix.

## Out of scope

- Host and pool bundles (follow-up; same builder, all sources, every disk on the host).
- Redaction.
- Raw payload history.
