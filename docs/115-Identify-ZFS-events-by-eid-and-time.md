---
type: task
status: planned
priority: p4
---

# Identify ZFS events by eid and time

`ZfsEvent` is unique on `(hostId, eid)`, but an eid is only unique for one load of the
ZFS module. Every reset therefore has to null the host's stored eids before the new
counter can reuse them ([107](107-False-ZFS-event-resets-after-a-reboot.md)).

## Idea

Make the identity `(hostId, eid, at)`, which `docs/003` listed before the schema settled
on `(hostId, eid)`. A ZED copy and a dump copy of one event carry the same `time`, so
they still dedupe, and events from different boots no longer collide. A reset then
needs no archive step, and old events keep their eids.

## Open points

- `maxStoredEidBelow` (missed-event detection) would see eids from earlier boots. It
  needs limiting to the current boot, for example to eids stored since the last
  `events-reset`, or a per-host generation counter.
- Retention's anchor rule (`eid < Host.zpoolEventsOldestEid - 1`) has the same problem.
- Hosts whose clock is wrong at boot ([116](116-Host-clock-faults-skew-ZFS-event-and-pool-history-times.md))
  still give each event one fixed `time`, so identity holds; only ordering by `at` is
  unreliable.
- Worth doing only if the archive step causes trouble again; since 107 it runs once per
  real reset.
