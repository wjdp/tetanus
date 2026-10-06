---
type: task
status: planned
---

# SMART error log

Stub. tetanus keeps only a flag saying the drive's error log has entries, not the
entries themselves.

## Problem

ATA drives keep a log of recent command errors (`ata_smart_error_log` in `smartctl
--xall --json`; NVMe has `nvme_error_information_log`). The entries say what failed,
at which LBA and at what power-on hour: useful context next to a climbing pending-sector
count, and for telling a cable or controller fault from a media fault. tetanus parses
only the exit-status bit `errorLogHasErrors` (`shared/smartctl.ts`). Starosdev has an
open request for the same view (#919).

## Context

- The full `--xall` output is kept as `Disk.latestRaw`, so the latest log is already
  stored; history isn't.
- New entries are an event worth a diary line.
- Related: kernel log ingest (Later in [004](004-Project-plan.md)) answers the same
  cable-or-disk question from the host side.

## Questions

1. Show only, or also a fault when new entries appear? Answered 2026-10-06: a warning
   fault on a rising count, [100](100-Error-log-growth-fault.md). This doc keeps the
   log view.
