---
type: task
status: planned
---

# SSD endurance

Stub. Show wear and projected end of life for SSDs from data already in `smartctl
--xall`. After Phase 3 ([004](004-Project-plan.md)).

## Sketch

- NVMe: `percentage_used`, `data_units_written` (×512 000 bytes). ATA: `241
  Total_LBAs_Written` (×sector size; vendor units vary, note per model), `177`/`231`/
  `233` wear-levelling and life-left attributes where present.
- Inventory field `ratedTbw` (registry entry, one line). Wear % = written / rated
  when set, else the device's own life-left attribute.
- Rate from the last 30 d of readings → projected date of 100 %.
- Surface: disk page nameplate ("38 % worn, ~6 y left at current rate"), inventory
  column, alert at 90 %.

## Unanswered questions

1. Which of mars's M/Z SSDs expose which attributes? Check the fixtures first.
