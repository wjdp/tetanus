---
type: task
status: done
---

# Learn replication cadence from regular syncs only

## Problem

A new replication starts with hand-run pushes: an initial full send, then one or two
incrementals while the schedule is being set up. [015](015-Replication-health.md)
learns the interval as the median gap of the last 10 syncs once there are 3, so those
pushes become a cadence of minutes to hours. The replication then goes late, then
stalled, before any schedule exists.

Seen on a real host: about 20 replications added to a new target pool, each with 2–7
syncs and gaps from about 1 min to about 45 h. Most are late or stalled.

A fixed grace period (say a week) does not fit: it is too long for a 5-min or hourly
schedule and too short for a weekly or monthly one.

## Context

- `learntIntervalMs` and `replicationHealth` in `shared/replications.ts`;
  `assessReplication` in `server/services/replications/queries.ts` feeds them.
- `manualIntervalSec` overrides the learnt interval and stays as is.
- Thresholds come from settings (`replication*` keys in `shared/schemas/settings.ts`),
  edited in `app/components/replication/ThresholdsForm.vue`. Stored config is merged
  over `DEFAULT_SETTINGS_CONFIG`, so a new key needs no migration.
- `applyDetections` resolves live faults that are no longer detected.
- `CadencePanel.vue` explains learning as "needs 3 syncs, has N".

## Plan

- Regular cadence. Take gaps between the newest 10 syncs, newest first. The interval
  is the median of the longest newest run of gaps that all lie within ±25 % of that
  run's median, and the run must be at least 4 gaps (5 syncs). Otherwise `learning`.
  - Settles in proportion to the schedule: 5-min in about 20 min, daily in 4 d,
    monthly in 4 months.
  - Applies to all replications. An extra hand-run push on an established one breaks
    the newest run, so it goes `learning` for a few cycles rather than late. That
    errs quiet.
- Maximum interval. A `learning` replication with no sync for more than
  `maxIntervalDays` (default 60) is `stalled`, `dueAt = lastSyncAt + max`. Learnt
  and manual intervals are not capped. New setting `replicationMaxIntervalDays`,
  int 1–3650, on the thresholds form.
- Constants: `REGULAR_GAPS = 4`,
  `REGULAR_GAP_TOLERANCE = 0.25`.
- Cadence panel learning note: "needs 4 regular gaps".
- Tests in `shared/replications.test.ts`: irregular pushes stay learning; 5-min,
  hourly, daily runs lock in; a stray push on an established run goes learning; run
  after irregular history uses only the regular run; learning past 60 d is stalled.
- Update 015 (Interval, Health) and
  [037](037-Status-and-icon-vocabulary.md) (`learning` row).

### Existing replications on the host

No reset feature needed. The new rule only reads recent sync times, so on the first
fault scan after deploy the irregular replications become `learning` and their
late/stalled faults resolve. Once the schedule runs, the 4 newest gaps are regular
and the cadence locks in; the hand-run pushes before it drop out of the run.
