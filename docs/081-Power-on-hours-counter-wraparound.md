---
type: task
status: planned
---

# Power-on hours counter wraparound

Stub. Split from [080](080-Vendor-override-warranty-check-links-and-vendor-SMART-hints.md)
on 2026-10-04.

## Problem

Some drives report attribute 9 (Power_On_Hours) as a 16-bit counter that wraps at
65,535 h, about 7.5 years. Past that point a long-lived disk suddenly reads young: age,
lifecycle and any warranty or retirement reasoning built on power-on hours go wrong, and
the drop looks like a SMART reset on a grey-market drive. Scrutiny detects the wrap from
history; tetanus doesn't.

## Context

- Raw-value quirks live in `shared/smart/transforms.ts`, which is per-reading and
  stateless (`transform(attrId, value, rawValue, rawString)`). A wrap is only visible
  against earlier readings, so it can't be spotted there alone.
- Power-on hours feed `shared/smart/evaluate.ts` (`power_on_hours`) and are stored per
  reading, so history is on the server.
- No fixture is near the limit: the highest in `test/fixtures/` is 55,121 h (a Samsung
  850 EVO). Which models wrap, and whether smartctl's drive database already widens any
  of them, is unknown.
- Not vendor-gated as far as is known.
- Related: Seagate FARM log (`smartctl -l farm`) carries factory power-on hours that
  survive SMART resets; collector addition, not filed yet.

## Questions

1. Which drive families actually wrap at 16 bits?
2. How should a detected wrap look to the user: corrected value, a diary entry, a fault?
