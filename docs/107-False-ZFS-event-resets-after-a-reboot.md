---
type: bug
status: todo
---

# False ZFS event resets after a reboot

After a host reboots, the diary gets a "ZFS event ids restarted" entry on every
`zpool-events` dump for up to three days, not just once.

## Problem

Seen in a prod snapshot (2026-11-16) after what looks like a power cut on all hosts on
2026-10-24:

- A host on OpenZFS 2.2: about 400 `events-reset` entries, one every 10 min, from
  2026-10-24 19:28 to 2026-10-27 17:00.
- An aarch64 host with no RTC: about 90 entries over 2026-10-24 and 2026-10-25.
- mars and the intermittent test host: one entry each per real reboot, as intended.

On the flooding hosts, the first entry is real (`previousMaxEid` is the eid from before
the reboot). Every entry after it has `previousMaxEid: null`. So `archiveEidsBefore`
found nothing to archive, yet `eidsReset` kept returning true.

## Context

- `checkContinuity`, `eidsReset` and `archiveEidsBefore` are in
  `server/services/zfs/events.ts`. [077](077-Out-of-order-ZED-events-trigger-false-gaps-and-resets.md)
  made dumps the only input to continuity checks.
- `eidsReset` returns true when:
  - a dump eid is already stored with a different `at` (renumbered), or
  - a stored eid above the dump's newest eid is older than that newest event, less
    `CLOCK_TOLERANCE_MS`.
- After a reset, `archiveEidsBefore(hostId, earliest)` nulls eids only for rows with
  `at < earliest`, where `earliest` is the timestamp of the oldest event in the dump.
- Likely cause (unproven): events written early in boot carry a timestamp from before
  the clock was set (no RTC, or before NTP sync). `earliest` then falls before the
  stored events from before the reboot, so none of them are archived. Their high eids
  keep satisfying the second condition until those boot-time events leave the kernel
  ring buffer. The flood on each host ended with a reset whose `previousMaxEid` was
  non-null, which fits.
- The evidence is gone: archiving nulls eids, and the dumps from then are no longer in
  `Payload`. A reproduction needs a fixture: a dump where post-reboot eids restart low
  but the oldest timestamps are earlier than the stored events from before the reboot.
- Each false reset also nulls eids, and [077](077-Out-of-order-ZED-events-trigger-false-gaps-and-resets.md)
  showed that breaks dedupe on `(hostId, eid)`. Check whether duplicate `ZfsEvent`
  rows appeared for the affected hosts in the window.

## Decisions to make

- What should the archive cut-off be after a reset? Options:
  - archive every stored eid when a reset is detected, ignoring time;
  - archive stored eids above the dump's newest eid;
  - keep the time cut-off but ignore implausible timestamps (before the host's
    `firstSeenAt`, or far before the previous dump).
- Should a reset be recorded at most once per boot, keyed on something other than eids
  (for example the `versions` payload's kernel or uptime, if the collector sent uptime)?
- Should the false diary entries already in prod be removed by a one-off repair, as 077
  did, or left alone?
