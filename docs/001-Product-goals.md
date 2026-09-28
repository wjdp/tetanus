---
type: reference
---

# Product goals

tetanus is a self-hosted disk and ZFS monitor for home NAS hosts: one server, a
collector per host. It replaces scrutiny's SMART dashboard and the hand-maintained
Obsidian disk inventory with one system that knows every disk it has ever seen: which
host it is in, what it's doing, how healthy it is, and what happened to it.

Single user, no UI auth, one unprivileged Docker container plus a small collector on
each host (bash + systemd timer + ZED hook) that POSTs with a shared enrol token.
Intended for publication. MIT licence.
Built on the grate stack: Nuxt 4, Nitro, Drizzle on SQLite, Nuxt UI.

## Who it's for

The author first. Then other home-NAS people running ZFS on Linux who want scrutiny's
SMART interpretation with disk lifecycle tracking and a ZFS view, without InfluxDB.

## What it must do

Kept from scrutiny:

- Every disk, connected or not, on one screen.
- SMART attributes with history, and an explanation of what each attribute means and
  whether it matters. Backblaze failure-rate context per attribute.
- Nameplate data: model, serial, firmware, capacity, power-on time, power cycles,
  temperature.

New:

- **Hosts.** Several hosts report to one server. Host list with per-host collector
  health; topology grouped by host.
- **Aliases.** The author's `K1`/`L3`/`Z5` scheme is the disk's name everywhere. Kernel
  names (`/dev/sdX`) are shown but never used as identity. Aliases are unique across
  hosts.
- **Lifecycle.** Each disk has a state: in-use, spare, removed, dead, sold. Inferred from
  ZFS membership and device presence, overridable by hand. Removed disks keep their
  history.
- **Inventory.** Purchase date, purchase price, supplier, purchase condition
  (new/used/refurbished/shucked), warranty expiry, 3.3 V pin tape flag, free-text notes.
  Age shown as calendar age and power-on time. Adding a field is one registry entry.
- **Diary.** Per-disk and per-pool timeline: manual markdown entries plus auto events
  (disk appeared/vanished, joined/left pool, attribute changed, fault accepted, scrub
  finished, resilver, ZFS state change).
- **Accepting faults.** Accept an attribute at a value (e.g. `K2` pending sectors = 16).
  Suppressed until the value increases. Acceptance is a diary entry.
- **Fault trend.** Per attribute: stable, worsening, rate of change. Feeds the accept UI.
- **ZFS view.** Pools → vdevs → disks with health, error counters, scrub/resilver state,
  capacity and fragmentation. Datasets and snapshots read-only. Snapshots browsable.
- **Alerts.** Pushover and webhook on new unaccepted fault, disk vanished/reappeared,
  pool not ONLINE, scrub with errors, and a recovery notice when a fault clears. Optional
  per-host ping to a healthchecks.io URL so silence is itself an alert.
- **vdev_id.conf.** Read for alias matching; can render a proposed file from the
  inventory. Never writes it.
- **Import.** One-off importers for scrutiny (device list + attribute history via its
  InfluxDB API) and for the Obsidian inventory table.

## What it must not do

- Write to the host in v1. No self-tests, scrubs, `zpool clear`. Actions are a later,
  feature-flagged phase.
- Depend on InfluxDB or any second service.
- Require listing block devices in compose. Disks come and go; the deployment must not
  drift.
- Reimplement scrutiny's attribute knowledge. Vendor it.

## Decisions (agreed 2026-09-28)

| Question | Decision |
| --- | --- |
| Disk state | Inferred from ZFS + presence, manual override |
| Fault accept granularity | Per attribute at value; resurfaces when value rises |
| Scrutiny history | Import device list + full attribute history |
| Alerting | Pushover + webhook + healthchecks.io ping; disk vanished, pool degraded, scrub errors, recovery |
| ZFS access from container | Host-side collector: systemd timer + ZED hook, kept minimal |
| ZFS scope v1 | Pools, vdevs, disks, datasets, snapshots |
| Diary | Manual + auto events |
| Home screen | Pool topology |
| Host actions | Read-only in v1 |
| vdev_id.conf | Read + propose, never write |
| SMART cadence | Hourly, keep every reading |
| Warranty | Expiry date entered by hand |
| Scrutiny code reuse | Vendor metadata; port evaluation or run their collector, decide later |
| Chart library | Decide later |
| Minimum host | Ubuntu 26.04-like: OpenZFS 2.3+ (JSON output), smartmontools 7.4+ (mars has 7.5) |
| Scrutiny transition | Separate systems; cut over when ready |
| Fixtures | Serials and WWNs scrubbed; project will be published |
| Name | tetanus (was tetanus, decided 2026-09-28); keep it in one place. See [008](008-Branding-and-colour.md) |
| Inventory fields | Purchase price and supplier added; fields are registry-driven so new ones are one line |
| Multi-host | From day one: a collector per host, one server. Container only ingests and processes, never runs host commands |
| Host enrolment | One server-wide enrol token, generated on first boot, shown on first-run and settings pages. Unknown host name auto-created on first POST; display name editable afterwards |
| Ingest auth | Every POST sends `Authorization: Bearer <token>` and `Tetanus-Host: <hostname -s>`. Wrong or missing token → 401. Required from day one |
| Alias scope | Unique across all hosts; the cohort scheme is global and disks move between hosts |
| Local producer | Dropped from v1. Host collector is the only producer; image has no smartmontools, container no `/dev` or capabilities |
| Disk↔host | `Disk.lastSeenHostId` only; seen on a different host → diary "moved" event |
| Healthchecks | Optional URL per host; ping succeeds only if that host's sources are fresh |
| Licence | MIT |

## Related

- [002 Prior art and problem space](002-Prior-art-and-problem-space.md)
- [003 Architecture and data model](003-Architecture-and-data-model.md)
- [004 Project plan](004-Project-plan.md)
