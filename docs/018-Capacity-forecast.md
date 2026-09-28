---
type: task
status: planned
---

# Capacity forecast

Stub. Project when each pool reaches 80 % and 100 % from `PoolReading` growth.
After Phase 5 ([004](004-Project-plan.md)).

## Sketch

- Linear fit over `PoolReading.alloc` for the last 30 d and 90 d; report both, flag
  when they disagree wildly (a one-off bulk copy). Ignore windows with a net decrease.
- Output: bytes/day, days to 80 %, days to full, confidence (r² or window coverage).
- Surface: pool page capacity chart with the projection dashed; `/zfs` column "full
  in"; alert rule when days-to-80 % drops below 60 d.
- `POOL_READING_DAYS` is 30 today; the 90 d fit needs a longer series or a daily
  downsample.

## Unanswered questions

1. Per-dataset forecast too (`Dataset.used`), or pool only?
