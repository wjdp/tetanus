---
type: bug
status: todo
---

# Missed ZFS events gap repeated on every dump

A single missed-events gap gets a new diary entry on every `zpool-events` dump until
it stops being detected.

## Problem

In a prod snapshot (2026-11-16), mars has six identical "Missed ZFS events
15381–15381" entries (`data: {from: 15380, to: 15382}`), one per dump from 06:02 to
06:51 on 2026-10-27. One event was missed once, but it was reported six times.

## Context

- `checkContinuity` in `server/services/zfs/events.ts`: a gap is reported when the
  dump's oldest eid is more than `maxStoredEidBelow(oldest) + 1`. Nothing records that
  the gap was already reported, so the same `before`/`oldest` pair is logged again on
  each dump until either:
  - the dump's oldest eid moves past the gap and the anchor below it changes, or
  - retention removes the anchor.
- The day before, the host's eids had restarted after a reboot (2026-10-24 and
  2026-10-25 resets on mars), so the gap may have come from a late-arriving or
  re-numbered event. Whether the event was really missed can't be checked now.
- History events are pruned only once they are below the dump's oldest eid
  (`zpoolEventsOldestEid`, [063](063-Retention-and-downsampling.md)), so the anchor
  `maxStoredEidBelow` reads should survive. The six dumps had the same oldest eid,
  15382, for about an hour on a host that writes about 12k events a day, which suggests
  the dump or the buffer was not moving as expected. Worth checking while fixing.
- `addAutoEvent` is in the diary service. Other diary writers dedupe by checking the
  latest entry of the same `eventType` for the subject.

## Decisions to make

- How to dedupe: skip when the host's latest `events-gap` entry has the same
  `from`/`to`, or store the last reported gap on `Host` (as `zpoolEventsOldestEid`
  is)?
- If a later dump shows a wider gap that overlaps the reported one, should that be a
  new entry or an update to the existing one?
