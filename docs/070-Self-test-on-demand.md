---
type: task
status: planned
---

# Self-test on demand

Stub. Start a short or long SMART self-test on a disk from tetanus.

## Problem

The most wanted feature that neither scrutiny nor its fork has delivered:
AnalogJ#12 (11 reactions, open since 2020) and Starosdev#168 (the fork's top open
issue). tetanus reads self-test logs but can't start a test.
[017](017-Scrub-and-self-test-overdue.md) will flag disks whose last long test is old
or missing; flagging an untested disk without offering to test it is half a feature.

[001](001-Product-goals.md) rules out writing to the host in v1, and the plan's Later
section has "actions behind a flag: short/long self-test, scrub, `zpool clear`".

## Context

- Same server-to-host channel problem as [064 Disk identify
  light](064-Disk-identify-light.md): the collector only POSTs. The options there
  apply here too: the collector polling for pending actions, a long-poll, or tetanus
  showing a command to run on the host.
- A long test on a large HDD takes many hours, and spinning the disk down aborts it on
  some drives. Progress shows up in later `--xall` readings
  (`ata_smart_data.self_test.status`).
- `smartctl -t long` is a write in the narrow sense, but it changes no data.

## Questions

1. Is this wanted at all? The author doesn't run long tests today and relies on ZFS
   scrubs. Scrubs read only allocated blocks; a long test reads the whole surface.
   Whether that difference matters for a disk that's entirely in a pool decides this,
   and also [017](017-Scrub-and-self-test-overdue.md)'s self-test half.
2. Channel: deferred until question 1 is answered (2026-10-04).
