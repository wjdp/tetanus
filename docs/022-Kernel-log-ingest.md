---
type: task
status: planned
---

# Kernel log ingest

Ship kernel messages about storage so cable, HBA and backplane faults show up next to
the disks they hit. SMART and `zpool events` both miss link resets and transport
errors. New source; fits the seam in [003](003-Architecture-and-data-model.md).

## Contract

- Collector: `journalctl -k --since "-<cadence+slack>" -o json` piped through a
  fixed `grep -E` for `ata[0-9]|scsi|sd[a-z]|nvme|SError|link (is slow|reset|down)|
  I/O error|blk_update_request|hard resetting link|SMART`. Sent with the ZFS
  cadence; small. Include `__CURSOR` so the server can dedupe and detect gaps; store
  the last cursor per host and send `--after-cursor` when the collector has one (a
  file under `/var/lib/<name>/`).
- Source `kernel-log`, parser: one JSON object per line → `{ at, cursor, message,
  device? }`. Device extraction: `ata<N>` → resolve via the udev source's
  `ID_PATH`/`ata` link, `sd<x>` and `nvme<n>n<m>` → kernel name → `Disk` via lsblk
  at ingest time (kernel names are correlation only, never identity).
- `KernelEvent` (`hostId`, `at`, `cursor` unique, `diskId?`, `class`, `message`).
  Classes: `link-reset`, `io-error`, `transport-error`, `smart`, `other`.
- Diary auto event on the disk when a new class first appears for it in 24 h; alert
  rule on `link-reset`/`io-error` bursts (≥ 3 in an hour), with the host and the
  alias.
- Surface: disk page "Kernel events" tab; host page tail; a hint on the disk status
  ("errors are on the link, SMART is clean: check cable/port").

## Steps

1. Capture a fixture on mars: `journalctl -k -o json | grep -E ... | tail -n 500`,
   scrubbed. Also one from a host with a known bad cable if any notes survive.
2. Parser + classifier, tests.
3. Persistence, device linking, diary/alert.
4. UI tabs.

## Unanswered questions

1. Does the container's timezone matter for `__REALTIME_TIMESTAMP`? (It's µs UTC; no.)
2. Keep raw messages forever, or cap per host at N rows?

## Findings

(agents append here)
