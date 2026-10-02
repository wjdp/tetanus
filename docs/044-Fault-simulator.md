---
type: task
status: todo
---

# Fault simulator

A "Simulate fault" dropdown on the disk page, pool page and each row of the hosts table
that injects a fake fault so you can see how the app presents it: badges, fault banners,
faults page, SMART table, vdev tree, diary, alerts. For dev (exercising UI states without
a sick disk) and the public demo ([034](034-Cloudflare-Workers-demo.md)), where visitors
can break things. "Restore" removes every trace.

## Approach

Inject at the ingest seam, not into tables. Take the host's latest stored `Payload` for
the relevant source, mutate it, replay through `recordIngest({ …, receivedAt: now })`.
Identity, SMART evaluation, topology, fault detection, diary auto events and alerts then
run the real code paths, as the demo generator does. Writing `Fault` rows directly
would light up the fault UI while the SMART table, vdev tree and pool state disagree.

### Undo log

Restore must leave nothing behind: no fault, diary entry, reading, notification. Rows
carry no provenance and `Payload` holds only the latest body per host/source/device (the
simulation overwrites the real one), so capture every write the simulation makes and
undo it.

- Tables `Simulation` (id, subjectType, subjectId, hostId, scenario, params, createdAt)
  and `SimulationChange` (simulationId, table, op, rowid, before json, after json).
- At boot, only when the simulator is enabled: drop and create `AFTER INSERT/UPDATE/DELETE`
  triggers on every schema table (generated from the Drizzle schema via `getTableConfig`,
  so they track schema changes; excluded: the two tables above, `__drizzle_migrations`).
  Triggers fire only while a one-row `SimulationCapture` table names an active
  simulation. No triggers in production unless opted in.
- A simulation runs in one transaction: set capture, replay payloads, clear capture.
  Fault actions the user takes on a simulated fault (acknowledge, accept, diary note)
  are also captured: route handlers for those check whether the fault was created by a
  simulation and run under its capture.
- Restore applies a host's changes in reverse order, all simulations on that host (the
  host-level sources `lsblk`, `udev`, `zpool-status` are shared between subjects, so
  per-subject undo can't be consistent). An undo entry is skipped when the row no
  longer matches its `after` image: a real collector run since (dev collector, demo
  hourly tick) has superseded it.
- No outbound alert sends for notifications created under capture; the rows still
  appear on the alerts page until restore.

Works on Durable Object SQLite too (plain triggers and SQL).

### Code

- `shared/simulator.ts`: scenario catalogue `{ id, label, group, subjectType,
  params: zod schema with defaults }`; the app builds menus and modal forms from it.
- `server/services/simulator/`: one module per scenario, `applies(subject)` and
  `mutate(payloads, subject, params) → payloads`, pure over raw bodies, unit-tested
  against `test/fixtures/` (smartctl xall JSON, `zpool status -j`). Plus `capture.ts`
  (triggers, capture, undo) and `run.ts` (load payloads, replay, restore).
- Routes: `GET /api/simulate/:subjectType/:id` (applicable scenarios, param choices
  such as the pool's leaves), `POST …` `{ scenario, params }`, `POST
  /api/simulate/hosts/:id/restore`. Bodies validated with `shared/schemas/simulate.ts`.
- `app/components/simulate/SimulateFaultMenu.vue`: `UDropdownMenu`, grouped; scenarios
  without params run on click; parameterised ones open `SimulateFaultModal.vue`
  pre-filled with defaults and Run focused, so Enter runs the default. "Restore <host>"
  at the bottom when the host has active simulations. Refreshes the page after.
- Placement: disk page header next to "Download diagnostics", pool page header, row
  actions in `settings/hosts.vue`.
- Applicability: attached non-ZFS disks get every disk scenario; disks not attached to
  a host (inventory-only, disposed) get no menu.

Gating: `runtimeConfig.public.faultSimulator`, on when `import.meta.dev` or demo;
`NUXT_PUBLIC_FAULT_SIMULATOR=true` opts in elsewhere. Routes 404 when off. In the demo
it works although ingest is 403 (the simulator calls the service, not the route);
everyone sees everyone's faults, which matches "Edit anything", and the daily reset
clears the rest.

## Scenarios

✱ = opens an existing `FaultKind`; the rest exercise status, colour and diary paths.
Params: default in brackets.

### Disk (`smartctl-xall` unless noted)

SMART attributes
- ✱ Pending sectors: count [8]
- ✱ Reallocated sectors: count [24]; run again with a higher count to show "worsening"
- ✱ Offline uncorrectable: count [16]
- ✱ UDMA CRC errors (cabling, not media): count [40]
- ✱ Command timeouts: count [12]
- ✱ Any attribute: attribute [select from this disk's table], raw value [current + 1]

Health
- ✱ SMART health FAILED (`smart_status.passed: false`, exit bit 3)
- NVMe critical warning: bits [available spare below threshold]
- NVMe media errors: count [4]
- SSD wear-out: percentage used [98]
- Self-test failed: type [extended], first failing LBA [random within capacity]

Temperature
- Running hot: °C [host warning threshold + 2]
- Critical: °C [host critical threshold + 2]

Presence (`lsblk`, `udev`, `smartctl-scan`)
- ✱ Missing: last seen [2 days ago]
- ✱ Identity conflict: with disk [next disk on the host]
- smartctl unreadable: exit bitmask [bit 1, device open failed], empty body

### Pool (`zpool-status`, `zpool-list`, `zpool-events`)

State
- ✱ Leaf fails: leaf [first leaf of first vdev], state [FAULTED | UNAVAIL | REMOVED |
  OFFLINE]; pool becomes DEGRADED, or UNAVAIL past redundancy
- ✱ Pool suspended (I/O failures past redundancy)
- Spare in use: failed leaf [first], spare [first spare]; INUSE spare, `spare-N` vdev

Errors and scans
- ✱ Scrub found errors: errors [3], repaired [64 MiB]
- Checksum errors on a leaf: leaf [first], read/write/cksum [0/0/12]; pool still ONLINE
- Permanent errors in files: count [2]; `errors: N data errors` status/action text
- Resilver in progress: leaf [first], progress [40 %]
- Scrub overdue: last scrub [60 days ago]; picked up once [017](017-Scrub-and-self-test-overdue.md) lands

Capacity (`zpool-list`)
- Nearly full: cap [92 %]
- Fragmented: frag [70 %]

Events
- Error burst: leaf [first], class [`ereport.fs.zfs.checksum`], count [10]

### Host (hosts table)

- ✱ Collector silent: last run [2 h ago]; moves the host's `CollectorRun.receivedAt`
  back (captured, so restore moves it forward)
- ✱ Collector outdated: version [previous minor]; replays `versions` with that producer
- ✱ Collector incompatible: version [below minimum]

## Steps

1. Undo log: tables and migration, trigger generation, capture, restore; unit tests
   (insert/update/delete round trip, superseded rows skipped).
2. Scenario catalogue and runner; first scenarios: pending sectors, health FAILED,
   missing. Tests against fixtures.
3. Routes and e2e test (simulate → fault open → restore → no fault, no diary, no
   readings, payload body back to the original).
4. Menu and modal on the disk page; component tests.
5. Pool scenarios (leaf fails, scrub errors, resilver) and pool page.
6. Host scenarios and hosts table.
7. Remaining scenarios; README development section.

## Questions

- Fault actions taken on a simulated fault: undo them on restore (as planned), or keep
  user-written diary notes?
