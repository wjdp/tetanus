---
type: task
status: todo
---

# Pool history storage volume

`PoolHistory` is the largest table, at about four times the size
[063](063-Retention-and-downsampling.md) estimated. Some lines from routine
replication are kept forever.

## Problem

A prod snapshot (2026-11-16, retention running, windows full) is 209 MB. `PoolHistory`
is 84 MB of that: 37 MB table, 41 MB unique index, 6 MB pool index. 063 estimated
about 23 MB steady.

- **Volume.** mars writes about 21k lines a day, not the 6k measured for 063. With
  routine lines kept for 14 days that is about 300k rows.
- **Three copies of each operation.** The collector runs `zpool history -il`, so each
  snapshot, destroy or receive is stored as:
  - the internal record (`snapshot tank/a@x (12345)`);
  - a multi-line `(NNms) ioctl snapshot` record with its `input:` nvlist;
  - the `zfs snapshot tank/a@x` command line.
- **The unique index copies the text.** `PoolHistory_hostId_at_text_key` covers
  `(hostId, at, text)` and is bigger than the table.
- **Routine lines kept forever.** `zfs rollback -R zeta/q@syncoid_…` and its `ioctl
  rollback` record come from syncoid's forced receive. They match none of the routine
  patterns, so they are kept forever: about 48 lines a day from one replication, or
  roughly 4 MB a year.
- **Garbled `ioctl load-key` lines.** Their `input:` block holds a few bytes of
  non-UTF-8 (shown as U+FFFD) followed by `[user 0 (root) on mars:linux]`. It's too
  short to be key material. It looks like how ZFS prints the hidden-args nvlist, but
  check that before deciding anything. These lines are kept forever.

## Context

- Classification: `isRoutineHistory` and its three regexes in
  `server/services/zfs/history.ts`. Unit-tested against captured `zpool history -il`
  fixtures.
- Ingest skips routine lines older than the cutoff (`retainedHistoryEntries`), so they
  don't come back after a prune. `zfs-receives` re-sends the last 2000 receive lines on
  every run.
- Readers:
  - the pool page (newest 50, [109](109-Pool-history-list-shows-only-routine-churn.md));
  - `observeReceives` / `population.ts`, which reads `RECEIVE_WINDOW_MS` (48 h) before
    the batch and matches on text;
  - `backfillReplications`, which was a one-off.
- Retention period: `ROUTINE_HISTORY_DAYS = 14` in `shared/retention.ts`, shown on
  Settings → Database through `RETENTION_RULES`.
- Which of the three forms do the readers need? Receive derivation matches text
  patterns in `population.ts`; check which form it uses before dropping any.
- The internal record carries the txg; the command line carries the full command and
  flags; the ioctl record carries timing.

## Decisions to make

- Retention period for routine lines: keep 14 days, or cut to just above the 48 h
  receive window (for example 3 days)? At 3 days the table drops to about 18 MB. 14 days
  had no stated reason beyond "a while".
- Store fewer forms: skip `ioctl` records for routine operations at ingest, or stop
  collecting `-l` / `-i` altogether? Dropping `-i` loses the internal records, which
  are the only form for operations done without a `zfs` command (for example some
  `receive` internals).
- Unique key: replace `text` in the index with a hash column (for example a 64-bit
  hash of the text), or a shorter natural key? A hash needs a migration that rebuilds
  the table and a collision policy.
- Class syncoid rollbacks as routine: all `rollback` lines, or only those whose target
  snapshot matches `@syncoid_`? A manual rollback is a notable event and should
  probably stay.
- `load-key` lines: strip the `input:` block at ingest, class them as routine, or
  leave them alone?
- After the change, does 063's "Forever cost" table in
  [003](003-Architecture-and-data-model.md) and the Settings → Database copy need
  updating? Yes, if the period changes.
