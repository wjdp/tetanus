---
type: task
status: done
---

# Out-of-order ZED events trigger false gaps and resets

The diary fills with "Missed ZFS events N–N" and "ZFS event ids restarted" entries
that are false. No events were lost and no host rebooted. Each false reset nulls every
stored eid for the host, and that breaks dedupe, so `ZfsEvent` fills with duplicates.

## Problem

The ZED hook (`host/zed/all-tetanus.sh`) sends each event with a backgrounded
`curl … &`. Sanoid/syncoid runs produce bursts of `history_event`s a few ms apart, so
concurrent POSTs reach the server in any order. `checkContinuity` in
`server/services/zfs/events.ts` assumes arrival order is eid order:

1. 52742 arrives before 52741: `firstUnseen > maxBefore + 1` → "Missed 52741–52741".
2. Then 52741 arrives: `eidsReset` sees `newest < maxBefore` with nothing stored for that
   eid → "restarted", and `archiveEids` nulls every eid for the host.
3. The max is now taken over a near-empty set, so the next out-of-order arrival repeats
   the cycle.
4. Zed and dump copies of an event are deduped by the `(hostId, eid)` unique index. With
   eids nulled, every `zpool events -vH` dump re-inserts the whole ring buffer.

Prod snapshot (`mars.needs-repair.db`, 2026-10-04, about 5 days of data):

- Diary: 2165 gaps and 1352 resets on host 1, 2832 gaps and 1705 resets on host 142.
  All false; the bursts checked were stored in full.
- `ZfsEvent`: 159,772 rows, about 80k of host 1's 81k with a null eid.
- 73k rows are byte-identical duplicates on `(hostId, at, class, payload)`. 104k share
  `(hostId, at, class)`.

### Secondary findings

- `at` + `class` doesn't identify an event: a syncoid send places one `hold`
  `history_event` per snapshot, all sharing the same nanosecond `time` and differing
  only in `history_dsname`/`history_dsid`. `isDuplicateUnnumbered` therefore drops
  distinct unnumbered events.
- The eid isn't stored in `payload`, so the nulled eids can't be recovered from rows.
  The latest `zpool-events` body in `Payload` still has the eids for whatever is in the
  ring buffer.
- `docs/003` lists `unique(hostId, eid, at)`; the schema has `unique(hostId, eid)`.

## Fix

Ingest:

- `zed-event` is an unordered, possibly lossy stream: insert it and dedupe on eid, with
  no continuity check.
- Run continuity checks only on `zpool-events` dumps, which are a complete, ordered view
  of the ring buffer:
  - **Reset:** a dump eid is already stored with a different `at`, or the dump's max
    eid is below the stored max with no overlap.
  - **Gap:** the dump's oldest eid is greater than stored max + 1, meaning the ring
    buffer evicted events the server never saw. Late zed arrivals can't cause one.
- Unnumbered dedupe keys on the event's identity, not just `at` + `class`.
- Zedlet: `wait` for curl instead of backgrounding it, and bump `version`. That narrows
  the race but doesn't remove it, because ZED can still run zedlets in parallel. The
  server fix shouldn't depend on it.

Migration (a hand-written SQL migration via `drizzle-kit generate --custom`, so it runs
at boot in prod):

1. Delete every `events-gap` and `events-reset` diary entry. All of them are false, and
   tetanus has only run for a few days, so nothing real is lost.
2. Deduplicate `ZfsEvent`, keeping one row per event: the numbered copy if there is one,
   otherwise the lowest id. Zed and dump copies of the same event may not be
   byte-identical (key sets differ between ZED env vars and `zpool events -v`), so
   compare on identifying fields, not raw payload text. Check this against the data
   before choosing a key.
3. Leave unrecoverable eids null. The next dump should re-attach eids to matching
   null-eid rows rather than insert copies (an ingest change, not a migration step), so
   the ring-buffer window heals on its own.

## Verification

- Unit tests in `server/services/zfs.test.ts`: zed events arriving shuffled give no
  diary entries and no eid loss. A dump after a real reboot gives one reset. A dump whose
  oldest eid skips ahead gives one gap. Distinct same-timestamp `hold` events are all
  kept.
- On a copy of `mars.needs-repair.db` (keep the original untouched as the pre-fix
  baseline): run `pnpm db:migrate`, then check:
  - no gap or reset diary entries remain;
  - no duplicate events remain on the chosen key;
  - row counts per host and class are plausible against the baseline;
  - no distinct `hold` events were lost.
- Run `pnpm dev` on the repaired copy for a few sanoid cycles: no new false gaps or
  resets, and the `ZfsEvent` count grows only by new events.

