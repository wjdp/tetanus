---
type: task
status: done
---

# Fault simulator

A "Simulate fault" dropdown on the disk page, pool page, replication page and each row
of the hosts table that injects a fake fault so you can see how the app presents it: badges, fault banners,
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

Restore must leave nothing behind: no fault, diary entry, reading, notification, nor
anything the user added meanwhile (acknowledgements, acceptances, notes). Rows carry no
provenance, `Payload` holds only the latest body per host/source/device (the simulation
overwrites the real one), and faults open in the async alerts pass rather than in
ingest. So: a global undo log, a rollback to the moment before the first simulation.

- Tables `Simulation` (id, scenario, subjectType, subjectId, params, createdAt) and
  `SimulationChange` (id, tableName, op, rowId, before json, after json).
- The first simulation creates `AFTER INSERT/UPDATE/DELETE` triggers on every schema
  table, generated from the Drizzle schema via `getTableConfig` (excluded: the two
  tables above). Every write from then on is logged, whoever makes it: the simulation,
  the user, a real collector run, the demo tick, another connection.
- Restore drops the triggers, applies the log in reverse (insert → delete, update →
  old image, delete → reinsert) with foreign keys deferred, then empties both tables.
  One transaction. Exact, because the log is complete.
- Cost: real data that arrived while a simulation was active is rolled back too; the
  next collector run or demo tick brings it back. Acceptable for dev and demo.
- While a simulation is active the alerts pass records notifications without sending
  (error "Simulated"), as the demo does.
- A layout banner shows while simulations are active: "N simulated faults · Restore".

No triggers exist outside an active simulation, so zero cost otherwise. Works on
Durable Object SQLite too (plain triggers and SQL).

### Code

- `shared/simulator.ts`: API types (`ScenarioView`, `ScenarioParam` number/select,
  `SimulatorStatus`) and `simulatorEnabled`. Params and their defaults come from the
  server per subject (current raw value + 1, the host's thresholds, the pool's leaves).
- `server/services/simulator/`: `capture.ts` (triggers, roll back, discard),
  `payloads.ts` (latest stored body with the meta and producer it came with),
  `subjects.ts`, `run.ts` (list scenarios for a subject, validate params, replay under
  capture, run the alerts pass so faults open at once, restore), helpers editing raw
  bodies (`smartctl.ts`, `zpool.ts`), and `scenarios/` by subject: `disk.ts`,
  `presence.ts`, `pool.ts`, `host.ts`, `replication.ts`. A scenario is `{ id, label, group, subjectType,
  applies?, params?, plan }`; `plan` returns edited payload copies to replay plus an
  optional direct write (backdating `lastSeenAt`, `CollectorRun.receivedAt`). A replay
  may name another host (a replication's source host).
- Routes under `/api/simulate`: `GET` (active simulations), `GET|POST
  /:subjectType/:id` (scenarios offered; run one with `{ scenario, params }`), `POST
  /restore`. 404 when the simulator is off.
- App: `useSimulator`, `SimulateFaultMenu` (scenarios without params run on click,
  others open `SimulateFaultModal` pre-filled with defaults; Enter submits),
  `AppSimulationBanner` in the layout. Menu in the disk page header, pool page header,
  replication page header and a column of the hosts table.
- Disks out of service (sold, retired, dead) or with no host get no scenarios; nor do
  archived replications (marked, or target pool archived). A replication's host is its
  target's, which collects its receives.
- `pnpm demo:seed --reset` discards an active capture before wiping.

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

Payloads are edited in the real `zpool status -j --json-flat-vdevs` shape: log, cache
and spare devices are top-level flat entries told apart by `class`; a spare in use is a
nested copy under `spare-N` plus its flat aux entry turned `INUSE`; `errlist`, `msgid`
and `moreinfo` are written as ZFS writes them. Since [046](046-ZFS-fault-coverage.md)
each scenario opens one fault (in brackets after the arrow), or none.

State
- ✱ Leaf fails: leaf [first leaf of first vdev], state [FAULTED | UNAVAIL | REMOVED |
  OFFLINE]; pool becomes DEGRADED, or UNAVAIL past redundancy → `pool-degraded`, red
  for FAULTED / UNAVAIL, amber for REMOVED / OFFLINE, leaf listed
- ✱ Disk pulled: leaf [first with a disk]; REMOVED, disk last seen backdated →
  `pool-degraded` alone, the leaf marked disk missing (no `disk-missing`)
- ✱ Cache device fails: cache device [first]; UNAVAIL, pool stays ONLINE →
  `pool-degraded`
- ✱ Pool suspended (I/O failures past redundancy) → `pool-degraded`, red
- ✱ Spare in use: failed leaf [first], spare [first AVAIL spare] → `pool-degraded`
  listing the failed leaf only (the `INUSE` spare is healthy)
- ✱ Pool vanishes: dropped from `zpool status` → `pool-missing`
- ✱ Unredundant special vdev: mirror [first special / dedup mirror]; every side but
  the first detached → `vdev-unredundant`
- ✱ Status message: message [`EY` hostid mismatch | `14` | `A5` | `ER` | `K4`] →
  `pool-status`

Errors and scans
- ✱ Scrub found errors: errors [3], repaired [64 MiB] → `pool-data-errors`
- ✱ Scrub repaired data: leaf [first], checksum errors [6], repaired [64 MiB]; no
  scan errors → `leaf-errors` on the leaf, nothing for the scrub
- ✱ Checksum errors on a leaf: leaf [first], read/write/cksum [0/0/12]; pool still
  ONLINE → `leaf-errors`, amber
- ✱ Checksum errors on a group: group [first mirror / raidz], cksum [4] →
  `leaf-errors` with role group, red
- ✱ Slow I/Os: leaf [first], added [20] → `leaf-slow`
- ✱ Permanent errors in files: count [2]; `errlist` paths, `ZFS-8000-8A` →
  `pool-data-errors` alone
- Resilver in progress: leaf [first], progress [40 %]
- ✱ Scrub paused: paused [30 h ago], progress [40 %] → `scrub-paused`
- ✱ Scan stalled: scan [scrub | resilver], no progress for [8 h]; backdates
  `Pool.scanProgressAt` → `scan-stalled`, red for a resilver
- ✱ Scrub overdue: last scrub [60 days ago]; later `scrub-finished` entries are deleted
  and `Pool.lastScrub` moved back (captured, so restore brings them back) →
  `scrub-overdue`

Capacity (`zpool-list`)
- Nearly full: cap [92 %]
- Fragmented: frag [70 %]

Events
- Error burst: leaf [first], class [`ereport.fs.zfs.checksum`], count [10]; events
  only, no fault

### Host (hosts table)

- ✱ Collector silent: last run [2 h ago]; moves the host's `CollectorRun.receivedAt`
  back (captured, so restore moves it forward)
- ✱ Collector outdated: version [previous minor]; replays `versions` with that producer
- ✱ Collector incompatible: version [below minimum]

### Replication (replication page, group Replication)

Since [015](015-Replication-health.md). Late and stalled need a known interval (not
`learning`); defaults land 30 min past the threshold, from the interval, the current
overdue and the global thresholds, rounded up to whole hours.

- ✱ Running late (status ok): hours [just past late] → `replication-late`; moves this
  replication's `ReplicationSync.at` and `lastSyncAt` back (`backdateSyncsOf`)
- ✱ Stalled (status ok or late): hours [just past stalled] → `replication-stalled`,
  superseding late
- Target dataset destroyed: the target host's `zfs-list` replayed without the dataset
  and its children → `present = false`, status `gone`, no fault
- Source dataset destroyed (source monitored): the same on the source host's
  `zfs-list`

Pool page: "Replication stalls" moves every replication into the pool back by hours
[96] (`backdateSyncsInto`).

## Gaps found while building

The simulator shows the app as it is; these scenarios show less than their label
because of the product, not the simulator:

- UDMA CRC errors: 199 is classed context, never fails, opens no fault.
- Command timeouts: fail only above a 10 % failure rate; default raised to 120.
- SSD wear-out at 98 %: NVMe fails only above 100, SATA wear attributes have no
  thresholds; values change but nothing turns red.
- Self-test failed: the row shows, but exit bit 7 feeds no status or fault.
- smartctl exit 2 (device open failed): no identity in the output, so nothing changes.
- ~~Pool spares section is not parsed (INUSE/AVAIL invisible); `error_count` is not
  shown on the pool page~~: spares are parsed and `error_count` shown with the damaged
  files since [046](046-ZFS-fault-coverage.md). Still no per-leaf resilvering marker.
- The demo renders vault's spare under a separate `spares` key, which neither the
  parser nor the simulator reads, so the demo offers no "Spare in use" (see
  [034](034-Cloudflare-Workers-demo.md)).
- Identity conflict lands on the older disk of the pair.
- Collector silent also marks every disk on the host missing; see
  [045](045-Silent-host-does-not-make-its-disks-missing.md).

## Steps

1. Undo log: tables and migration, trigger generation, capture, restore; unit tests
   (insert/update/delete round trip, cascades, untouched tables).
2. Scenario catalogue and runner; first scenarios: pending sectors, health FAILED,
   missing. Tests against fixtures.
3. Routes and e2e test (simulate → fault open → restore → no fault, no diary, no
   readings, payload body back to the original).
4. Menu and modal on the disk page; component tests.
5. Pool scenarios (leaf fails, scrub errors, resilver) and pool page.
6. Host scenarios and hosts table; layout banner.
7. Remaining scenarios; README development section.

