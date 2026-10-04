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

Done 2026-09-28: [010](010-Phase-2-ingest-seam-and-parsers.md). Outstanding: a standby
(exit 2) smartctl fixture from mars; e2e tests for `/api/hosts`.

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

Done 2026-09-28: [011](011-Phase-3-SMART-knowledge.md). Self-tests are persisted but not yet
exposed by the API.

1. `bin/generate-smart-metadata` (Go one-file program or script) producing
   `shared/smart/metadata.json` from a scrutiny checkout. Commit the JSON.
2. `shared/smart/transforms.ts` (188, 194). `shared/smart/evaluate.ts`: attribute and
   device status per scrutiny, SCSI bug fixed, one threshold policy. Tests from
   scrutiny's `smart_test.go` expectations over the copied fixtures.
3. Persist `SmartReading`, `SmartAttribute`, `TemperatureReading` (SCT backfill),
   `SelfTest`. Update `Disk.latest*`.
4. Trend: 7 d / 30 d comparison per attribute.

## Phase 4: disks, identity, state

Done 2026-09-28: [012](012-Phase-4-disks-identity-and-state.md). The Obsidian importer
(step 6) landed with Phase 6 and was removed again on 2026-09-28: not worth keeping.

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
6. ~~Obsidian importer:~~ (removed) paste/upload the Bases table as markdown or CSV; match rows to
   disks by serial, create inventory-only rows for the rest (H1–H4).

## Phase 5: ZFS topology

Done 2026-09-28: [013](013-Phase-5-ZFS-topology.md).

1. Upsert `Pool` (per host), `Vdev` from `zpool-status` + `zpool-list`; link
   `Vdev.diskId` via path/devid → `DiskKey`. `PoolReading`/`VdevReading` per ingest.
2. Membership changes and ZFS state changes → diary auto events.
3. `ZfsEvent` and `PoolHistory` persistence, incremental, gap detection on `eid`.
4. Home page topology tiles, grouped by host. Pool page with scan
   state and error counters.

## Phase 6: disk page and inventory UI

Done 2026-09-28: [014](014-Phase-6-disk-page-and-inventory-UI.md). Chart library: uPlot.
Not yet validated in a browser by the author; `bin/replay-fixtures.sh` loads the mars
fixtures into a dev server for that.

1. Disk page: nameplate, inventory edit, attribute table with explanation rows, failure
   rate, inline SVG sparklines.
2. Inventory table page with sort/filter, computed ages, warranty countdown.
3. Temperature and attribute history charts: pick the library here (uPlot leading).
4. Command palette entries.

## Phase 7: diary and fault acceptance

Done 2026-09-28: [025](025-Phase-7-diary-and-fault-acceptance.md).

1. `DiaryEntry` CRUD, markdown body, global and per-subject timelines.
2. `FaultAcceptance` create/supersede/clear, overlay in evaluation, accept dialog
   showing trend.
3. Auto events wired from phases 4–5 (appeared, vanished, moved host, joined pool,
   left pool, attribute changed status, scrub finished, resilver, state override).

## Phase 8: alerts

Done 2026-09-28: [026](026-Phase-8-alerts.md).

1. Rules after each ingest: new unaccepted failed attribute, disk missing, disk
   reappeared, pool not ONLINE, scan finished with errors, fault cleared (recovery).
   Dedupe on `(rule, subject, value)`. Subjects carry the host name. Later rules
   ([017](017-Scrub-and-self-test-overdue.md), [020](020-Warranty-nudge.md),
   [015](015-Replication-health.md)) plug into the same engine.
2. Channels: Pushover, generic webhook JSON. Test button.
3. healthchecks.io ping per host (`Host.healthchecksUrl`, optional) on a timer; ping
   succeeds only if that host's sources are fresh. Move `hostFreshness` to `shared/` and
   reuse it; do not re-derive.
4. Collector-silence fault banners.

## Phase 9: ZFS datasets and snapshots

Done 2026-09-28: [029](029-Phase-9-ZFS-datasets-and-snapshots.md). The mars `zfs-snapshots` fixture
still needs re-capturing with `guid` (user); `host/test/stub.sh` carries a temporary mapping until then.

1. `Dataset`, `Snapshot` upsert on slow cadence; never list on request path.
2. Dataset tree page with used/referenced/compressratio/quota; snapshot list per
   dataset with age and size; counts on pool page.
3. Collect snapshot `guid` from the start: [015](015-Replication-health.md) pairs
   datasets across hosts on it.

## Phase 10: scrutiny import

Done 2026-09-28: [030](030-Phase-10-scrutiny-import.md); cut-over pending (user). Decided
2026-09-28: read scrutiny's REST API instead of InfluxDB and its SQLite file.

1. ~~Importer against scrutiny's InfluxDB HTTP API (token from its config) and its SQLite
   device table.~~ Importer against scrutiny's web API. Join on scrutiny UUID; fall back to model+serial. Takes a target host
   for the imported readings.
2. Devices → `Disk` (removed ones become inventory rows with `lastSeenAt`), `smart`
   measurement → `SmartReading`/`SmartAttribute` across all four buckets, `temp` →
   `TemperatureReading`. Coarse older data is coarse; say so in the UI.
3. Run once against the live scrutiny on mars; cut over and retire scrutiny.

## After v1

Each has its own task doc, status `planned`. Order is by how much it improves the
author's day; none blocks another except where noted.

1. [015 Replication health](015-Replication-health.md): pair datasets across hosts by
   snapshot GUID, show lag, divergence, interrupted receives. Needs Phase 9. Includes a
   `job-report` ingest for non-ZFS backups.
2. [022 Kernel log ingest](022-Kernel-log-ingest.md): link resets and I/O errors from
   `journalctl -k`, tied to disks. Cable vs disk diagnosis.
3. [017 Scrub and self-test overdue](017-Scrub-and-self-test-overdue.md).
4. [016 Snapshot staleness](016-Snapshot-staleness.md).
5. [024 ZFS property audit](024-ZFS-property-audit.md): `zpool get` / `zfs get`,
   change diary, baseline rules.
6. [021 Pool version diary](021-Pool-version-diary.md): version and feature-flag
   changes recorded against the pool. Needs 024's source.
7. [018 Capacity forecast](018-Capacity-forecast.md).
8. [023 Disk stats ingest](023-Disk-stats-ingest.md): `/proc/diskstats` for idle
   disks and write volume.
9. [019 SSD endurance](019-SSD-endurance.md). Better with 023.
10. [020 Warranty nudge](020-Warranty-nudge.md) and RMA sheet.

Stubbed 2026-10-04 from a gap review against the README pitch, unordered:
[055 Pool capacity fault](055-Pool-capacity-fault.md),
[056 Manual disk creation](056-Manual-disk-creation.md),
[057 Temperature fault](057-Temperature-fault.md),
[058 More alert channels](058-More-alert-channels.md),
[059 Dataset quota nearly full](059-Dataset-quota-nearly-full.md),
[060 Inventory export](060-Inventory-export.md),
[061 Physical bay mapping](061-Physical-bay-mapping.md),
[062 Non-Linux hosts](062-Non-Linux-hosts.md),
[063 Retention and downsampling](063-Retention-and-downsampling.md),
[064 Disk identify light](064-Disk-identify-light.md).

Stubbed 2026-10-04 from a review of Starosdev's scrutiny fork, unordered:
[069 Merge and split disk records](069-Merge-and-split-disk-records.md),
[070 Self-test on demand](070-Self-test-on-demand.md),
[071 Verdict reasons in lists and alerts](071-Verdict-reasons-in-lists-and-alerts.md),
[072 Prometheus metrics endpoint](072-Prometheus-metrics-endpoint.md),
[073 Collector device exclusion and type override](073-Collector-device-exclusion-and-type-override.md),
[074 SMART error log](074-SMART-error-log.md),
[075 Home Assistant integration](075-Home-Assistant-integration.md).

## Later

- `zpool iostat` latency view; the only text parser, needed by no v1 screen.
  [023](023-Disk-stats-ingest.md) covers most of the need.
- vdev_id.conf proposal renderer.
- Actions behind a flag: short/long self-test, scrub, `zpool clear`.
- Retention/downsampling if the DB grows past comfort.
- Physical bay mapping ([061](061-Physical-bay-mapping.md)): SES slots from `/sys/class/enclosure`, `ID_PATH` otherwise, user-labelled bays.
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
11. Collector cadence: ZFS every 10 min, SMART hourly, snapshots hourly (6 h until [015](015-Replication-health.md)); three timers,
    one template unit. Collector stays bash until it needs per-device config.
12. `zpool iostat` dropped from v1.

## Unanswered questions

1. ~~Chart library~~ uPlot, decided at phase 6.
