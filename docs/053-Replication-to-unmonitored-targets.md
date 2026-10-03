---
type: task
status: planned
---

# Replication to unmonitored targets

Stub, not scheduled. Pick up if a dataset is ever replicated to a target tetanus cannot
see (rsync.net, a friend's NAS, a host without the collector). Builds on
[015](015-Replication-health.md); decided 2026-10-03 to leave out of it.

## Why

[015](015-Replication-health.md) learns replication from the target pool's receive
history. A target tetanus does not monitor leaves nothing to observe: the source shows
no replication and can never fault when the push stops.

## Signal

- A send run on the source host logs `zfs send … <dataset>@<snap>` (or `zfs send -I`,
  `-i`, `-R`, `-w`) in the source pool's history. Seen daily on mars `zeta` from
  syncoid before 015 stage 1.
- Only pushes are logged on the source. A pull (syncoid run on the target, ssh into the
  source) logs nothing there.
- A logged send is not proof of a successful receive: the command line is written on
  exit, but a remote `zfs recv` can still fail after the stream ends. Treat it as
  "attempted", weaker than a receive.

## Sketch

- Collector: add `zfs send ` to the `zfs-receives` grep (`receive_lines` in
  `host/tetanus-collect`; rename the source or keep the name). Same per-pool tail.
- Server: evidence kind `send` on `ReplicationSync`; a replication with a source and no
  monitored target (mirror of 015's scenario 3), keyed on source dataset + a target
  label parsed from the command line where available (syncoid logs only the local side,
  so usually none: label "unmonitored").
- Cadence and health as 015, learnt from `send` syncs only.
- Pairing: when the target is later monitored, its receive evidence takes over and the
  `send` replication merges into the paired one.

## Unanswered questions

1. One replication per source dataset, or one per (source, destination) when a dataset
   is pushed to two unmonitored targets? Send lines rarely name the destination.
2. Should a push to a monitored target also record `send` evidence, as a cross-check?
