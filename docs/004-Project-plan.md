---
type: task
status: in-progress
---

# Project plan

Phased build of tetanus per [001](001-Product-goals.md) and
[003](003-Architecture-and-data-model.md). Each phase is a shippable increment; each
step is roughly one commit. Order is by dependency, then by how much it improves the
author's day.

From Phase 1 on, each phase gets its own task doc (`wj new task`); this doc is the index.

## Phase 0: fixtures from mars

Nothing can be written correctly without real output. All read-only. Steps 1–2 done in
[005](005-Capture-mars-fixtures.md); steps 3–4 in
[006](006-Vendor-scrutiny-corpus-and-Q2-event-fixture.md).

1. Script `bin/capture-fixtures.sh`: `zfs version`, `smartctl --version`, `lsb_release
   -a`, `zpool status -j --json-flat-vdevs --json-int -PLpvs` (also without
   `--json-flat-vdevs` once, to see the nested shape), `zpool list -j --json-int -pv`,
   `zpool iostat -vpl 1 2`, `zfs list -j --json-int -p -t filesystem,volume -o <cols>`,
   `zfs list -j --json-int -p -t snapshot ...` truncated + count, `zpool history -il | tail -500`, `zpool events -vH`, `cat
   /etc/zfs/vdev_id.conf`, `ls -l /dev/disk/by-vdev /dev/disk/by-id`, `lsblk -J -b -o
   ...`, `/run/udev/data/b*` for each disk, `smartctl --scan --json`, `smartctl --xall
   --json -n standby` for one of each model family (K WD, K6 Seagate, L Toshiba, L
   Seagate, Q Seagate, M SSD, Z Samsung) plus a standby disk to capture exit 2.
2. The script scrubs in place: serials, WWNs, pool and vdev GUIDs replaced by
   deterministic fakes (same length and character class, stable across the capture so
   udev, by-id, vdev_id.conf and smartctl still agree). Author runs it on mars, eyeballs,
   commits under `test/fixtures/mars/`.
3. Copy scrutiny's `testdata/*.json` under `test/fixtures/scrutiny/` with licence notice.
4. Copy the Q2 failure `zpool events -v` capture from notes as a fixture.

## Phase 1: scaffold

Clone grate's shape, not its code. Task: [007](007-Phase-1-scaffold.md).

1. `pnpm create nuxt`, Nuxt 4 + Nuxt UI + Tailwind 4, Biome (grate's config incl.
   `noRestrictedImports` ban on `app/`→`server/`), lefthook, vitest two-project config,
   `pnpm typecheck` green on first commit.
2. Drizzle + better-sqlite3, `server/database/{client,schema,migrate,migrate-cli}.ts`
   lifted from grate, `test/setup.ts` with per-file `:memory:` DB, `test/db.ts` flush.
3. Task queue + SSE + `shared/sse.ts` + `shared/tasks.ts` lifted from grate. Sidebar
   task indicator.
4. Settings single row (incl. `enrolToken`, generated on first boot), `/api/settings`,
   `/health`.
5. Dockerfile (4-stage; no smartmontools, as there is no local producer), `run.sh`,
   compose sketch from 003, GitHub workflows (checks, edge, release).
6. `AGENTS.md` + `CLAUDE.md` symlink, README skeleton, `000-Docs.md` project specifics.
7. Layout: sidebar (Topology, Disks, ZFS, Diary, Settings), command palette shell,
   fault banner slot.

## Phase 2: ingest seam and parsers

1. `POST /api/ingest/:source` accepting text, storing `CollectorRun`, dispatching to a
   parser registry. Bearer enrol token check (401 otherwise); `Tetanus-Host` header
   upserts `Host` and sets `CollectorRun.hostId`. Unknown source → 400. Body size limit.
2. Parsers with fixture tests: `smartctl-scan`, `smartctl-xall` (ATA, NVMe, SCSI;
   `smart_support` dual shape; capacity fallback; WWN reassembly; exit bitmask
   decode), `lsblk`, `udev` (E: and S: lines), `vdev-id-conf` (alias lines, both path
   forms, ignore unknown directives).
3. `zpool-status` JSON parser (`--json-flat-vdevs`, `--json-int`): vdev tree by
   `parent`/`guid`, `-P` paths and `-L` names, error counters, slow IOs, scan state,
   `errors` block. `zpool-list` JSON. Reject `output_version.vers_major != 0`.
4. `zfs-list`, `zfs-snapshots` JSON; `zpool-history` text; `zpool-events -vH` text
   (hex-string numerics); ZED env payload.
5. ~~`zpool-iostat` text parser~~ dropped from v1 (moved to Later, 2026-09-28).
6. Host collector: `host/<name>-collect` bash script (curl only), systemd service +
   timer, `host/zed/all-<name>.sh`, `host/install.sh`, docs. Clears `ZPOOL_VDEV_NAME_*`,
   passes `-n standby`, sends smartctl exit status, `Authorization: Bearer <token>` and
   `Tetanus-Host: $(hostname -s)`. The only producer in v1.
7. First-run page (enrol token, install one-liner, which hosts and sources have
   reported) and Settings > Hosts (rename, last seen per source).

## Phase 3: SMART knowledge

1. `bin/generate-smart-metadata` (Go one-file program or script) producing
   `shared/smart/metadata.json` from a scrutiny checkout. Commit the JSON.
2. `shared/smart/transforms.ts` (188, 194). `shared/smart/evaluate.ts`: attribute and
   device status per scrutiny, SCSI bug fixed, one threshold policy. Tests from
   scrutiny's `smart_test.go` expectations over the copied fixtures.
3. Persist `SmartReading`, `SmartAttribute`, `TemperatureReading` (SCT backfill),
   `SelfTest`. Update `Disk.latest*`.
4. Trend: 7 d / 30 d comparison per attribute.

## Phase 4: disks, identity, state

1. `DiskKey` extraction from smartctl + udev + lsblk; `identity.match()` pure; merge on
   ingest; conflict diary + banner.
2. `Disk` registry upsert on every SMART or scan ingest (self-heal on unknown disks,
   never throw). `lastSeenAt` and `lastSeenHostId` on every sighting; a different host
   → diary "moved from mars to X".
3. Alias (unique across hosts) resolution from udev `S:` links, `zpool status -P`,
   `vdev_id.conf`. Drift detection.
4. State inference + override, `missing` threshold setting, transitions → diary.
5. `shared/inventory-fields.ts` registry → zod schema, `PATCH /api/disks/:id`, form and
   table generation. Initial fields: purchase date, price, supplier, condition, warranty
   expiry, 3.3 V pin.
6. Obsidian importer: paste/upload the Bases table as markdown or CSV; match rows to
   disks by serial, create inventory-only rows for the rest (H1–H4).

## Phase 5: ZFS topology

1. Upsert `Pool` (per host), `Vdev` from `zpool-status` + `zpool-list`; link
   `Vdev.diskId` via path/devid → `DiskKey`. `PoolReading`/`VdevReading` per ingest.
2. Membership changes and ZFS state changes → diary auto events.
3. `ZfsEvent` and `PoolHistory` persistence, incremental, gap detection on `eid`.
4. Home page topology tiles, grouped by host. Pool page with scan
   state and error counters.

## Phase 6: disk page and inventory UI

1. Disk page: nameplate, inventory edit, attribute table with explanation rows, failure
   rate, inline SVG sparklines.
2. Inventory table page with sort/filter, computed ages, warranty countdown.
3. Temperature and attribute history charts: pick the library here (uPlot leading).
4. Command palette entries.

## Phase 7: diary and fault acceptance

1. `DiaryEntry` CRUD, markdown body, global and per-subject timelines.
2. `FaultAcceptance` create/supersede/clear, overlay in evaluation, accept dialog
   showing trend.
3. Auto events wired from phases 4–5 (appeared, vanished, moved host, joined pool,
   left pool, attribute changed status, scrub finished, resilver, state override).

## Phase 8: alerts

1. Rules after each ingest: new unaccepted failed attribute, disk missing, disk
   reappeared, pool not ONLINE, scan finished with errors, fault cleared (recovery).
   Dedupe on `(rule, subject, value)`. Subjects carry the host name.
2. Channels: Pushover, generic webhook JSON. Test button.
3. healthchecks.io ping per host (`Host.healthchecksUrl`, optional) on a timer; ping
   succeeds only if that host's sources are fresh.
4. Collector-silence fault banners.

## Phase 9: ZFS datasets and snapshots

1. `Dataset`, `Snapshot` upsert on slow cadence; never list on request path.
2. Dataset tree page with used/referenced/compressratio/quota; snapshot list per
   dataset with age and size; counts on pool page.

## Phase 10: scrutiny import

1. Importer against scrutiny's InfluxDB HTTP API (token from its config) and its SQLite
   device table. Join on scrutiny UUID; fall back to model+serial. Takes a target host
   for the imported readings.
2. Devices → `Disk` (removed ones become inventory rows with `lastSeenAt`), `smart`
   measurement → `SmartReading`/`SmartAttribute` across all four buckets, `temp` →
   `TemperatureReading`. Coarse older data is coarse; say so in the UI.
3. Run once against the live scrutiny on mars; cut over and retire scrutiny.

## Later

- `zpool iostat` latency view; the only text parser, needed by no v1 screen.

- vdev_id.conf proposal renderer.
- Actions behind a flag: short/long self-test, scrub, `zpool clear`.
- Retention/downsampling if the DB grows past comfort.
- Physical bay mapping via `vdev_enc_sysfs_path` / `zpool status -c`.
- Scrutiny-collector adapter routes, if detection on other people's hardware needs it.
  Needs the host header mapped.
- Local producer: in-container `execFile` for SMART, udev and vdev_id.conf (static
  smartmontools, `/dev` mount, cgroup rules), for users who won't install on the host.
- ARC stats from `/proc/spl/kstat/zfs`.

## Answered 2026-09-28

1. mars: OpenZFS 2.4.1, smartctl 7.5, Ubuntu 26.04. JSON-only ZFS parsers.
2. Host-side systemd timer + ZED hook: yes, keep minimal. Container unprivileged.
3. Scrutiny stays separate; cut over when ready.
4. Pasted `vdev_id.conf` is current.
5. Fixtures scrubbed; project will be published.
6. Name provisional; single constant.
7. Purchase price and supplier added as optional; registry-driven fields.
8. Licence: MIT.
9. Ingest auth: bearer enrol token required from day one, plus `Tetanus-Host`.
   Multi-host from day one; no local producer in v1.
10. Scrutiny reuse: (b), parse smartctl JSON in TS server-side; (a) stays under Later.
11. Collector cadence: ZFS every 10 min, SMART hourly, snapshots every 6 h; three timers,
    one template unit. Collector stays bash until it needs per-device config.
12. `zpool iostat` dropped from v1.

## Unanswered questions

1. Chart library: deferred by decision; revisit at phase 6.
