---
type: task
status: planned
---

# Retention and downsampling

Stub. Everything is kept forever. Decide when that stops being fine and what to do
about it.

## Problem

[003](003-Architecture-and-data-model.md) says keep everything in v1 and leave
`SmartAttribute` easy to downsample later. The dev database after replaying about
seven years of a three-host demo fleet is 84 MB, dominated by `PoolHistory` (text plus
its unique index, about 48 MB) and `TemperatureReading` (416 k rows, 14 MB with
index); `SmartAttribute` is 73 k rows. A real fleet with more disks, hourly SMART and a
long-running pool with busy `zpool history` will grow without bound, and the SQLite
file is also the backup the README tells people to keep.

Nothing is urgent. The point of the task is to know the growth rate per table, decide
which tables have a natural retention (raw payloads, pool history, events) and which
are the product (attribute history, diary), and pick a point before someone's NAS
database is a gigabyte.

## Context

- Row counts and sizes per table from `dbstat` on `dev.db` after `pnpm demo:seed`
  give a baseline; the seed's cadence matches the real collector.
- `Payload` stores raw collector bodies (106 rows in dev, 3 MB); `CollectorRun` is
  one row per source per run (8 k rows). Whether raw bodies are kept and for how long
  is a separate decision from readings.
- `PoolHistory` is the tail of `zpool history -il` per run, deduplicated on
  `(hostId, at, text)`; a busy pool (frequent snapshots, replication) grows it fast.
- `TemperatureReading` includes SCT history backfill, which samples far more often
  than hourly; the disk page charts read it at full resolution.
- `SmartAttribute` is one row per attribute per reading; the attribute charts and the
  7 d / 30 d trend read it. Scrutiny-imported history is already coarse and the UI
  says so ([030](030-Phase-10-scrutiny-import.md)), so the charts can cope with mixed
  resolution.
- Faults, diary, acceptances and notifications are small and are the product; never
  touched.
- SQLite does not shrink on delete without `VACUUM`, which needs free disk equal to
  the database size.

## Questions

1. What is the growth per disk per year at the real cadence? Measure before deciding.
2. Hard cap, age-based, or downsample to daily after N days? Per table.
3. Does the user get a setting, or is the policy fixed and documented?
