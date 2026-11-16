---
type: bug
status: todo
---

# Host clock faults skew ZFS event and pool history times

Hosts with no working RTC record events from early boot at the wrong time, so they
show up days away from when they happened.

## Problem

In a prod snapshot (2026-11-16), an x86 host stamped the `pool_import` and
`config_sync` events of two consecutive boots (2026-10-24 and 2026-10-25) with the same
time, 2026-10-12 07:36, 12 to 13 days early. Later events from the same boots, after the
clock was set, are correct. A Raspberry Pi host has no RTC at all and showed the same
pattern in [107](107-False-ZFS-event-resets-after-a-reboot.md). The likely mechanism is
a dead RTC battery or no RTC, with the clock restored from a saved time
(systemd-timesyncd's clock file, `fake-hwclock`) until NTP syncs.

Some hosts can't be fixed (a Pi has no RTC), so tetanus should cope with them.

## Context

- Host time enters through the event `time` field (`ZfsEvent.at`), `zpool history`
  timestamps (`PoolHistory.at`) and anything built on them: the pool Events tab, diary
  backfill from pool history ([113](113-Backfill-the-diary-from-pool-history-and-imported-readings.md)),
  scrub and resilver times taken from history. Collector runs and readings use the
  server's receive time.
- [107](107-False-ZFS-event-resets-after-a-reboot.md) removed host time from the eid
  reset check: event times are now only compared for equality.
- Within one boot, eids rise. After NTP steps the clock, times rise too, but events
  from before the step can carry any earlier time.
- The server knows bounds for each event: after the last event it stored from the
  previous boot, and before the receive time of the dump or ZED post that carried it.
- The collector sends no host clock reading or uptime, so the server can't measure the
  offset directly.
