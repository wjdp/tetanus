---
type: task
status: planned
---

# Disk stats ingest

Per-disk I/O counters from `/proc/diskstats`: bytes read and written, I/O time.
Cheap, text, no `zpool iostat` parser needed. Gives idle-disk detection and write
volume for [019](019-SSD-endurance.md). New source per
[003](003-Architecture-and-data-model.md).

## Contract

- Collector: `cat /proc/diskstats`, sent with the ZFS cadence.
- Source `diskstats`, parser: whole-disk rows only (skip partitions: major/minor
  present in lsblk as `type=disk`), fields per `Documentation/admin-guide/iostats.rst`:
  reads completed, sectors read, ms reading, writes completed, sectors written, ms
  writing, ms doing I/O, weighted ms, discards. Sectors are 512-byte here regardless of
  device sector size.
- `DiskStatReading` (`diskId`, `hostId`, `at`, cumulative counters). Kernel name →
  `Disk` via the latest lsblk for that host, as for [022](022-Kernel-log-ingest.md).
  Counters reset on reboot: a decrease means a new epoch; deltas are computed between
  consecutive rows of the same epoch only.
- Derived: bytes/day read and written over 24 h and 30 d, busy % over the window,
  "idle" when busy < 1 % for 7 d.
- Surface: disk page throughput sparkline and busy %; inventory columns "written/day"
  and "idle"; pool page per-vdev busy % to spot a slow member (an unbalanced mirror or
  a resilver hot spot).

## Steps

1. Fixture from mars (`bin/capture-fixtures.sh`).
2. Parser and epoch-aware delta helper, pure, tested.
3. Persistence and linking.
4. UI.

## Unanswered questions

1. Keep every 10-min row (≈ 50k rows/disk/yr), or store only hourly deltas?

## Findings

(agents append here)
