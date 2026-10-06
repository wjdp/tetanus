---
type: task
status: planned
---

# Disk notes for cabling and power

From [085](085-Disk-fault-coverage.md), gap 4. Depends on the notes tier in
[084](084-Statistics-tab.md). Decisions taken 2026-10-06.

## Problem

Several collected signals point at the cable, backplane, controller or power supply
instead of the drive. They don't deserve a fault each, but today they are visible only
as raw figures on the SMART and FARM tabs.

## Design

Each of these becomes a `DiskNote` (084: shown on Overview and the Statistics tab, no
alert). Notes about the connection or power are tagged "cabling or power, not the
drive", and [086](086-Disk-risk-level.md) lists them as reasons without raising the
level.

| Note | Source | Rule |
|---|---|---|
| Interface CRC errors rising | attribute 199; device statistics 6:24 and FARM `crcErrors` where 199 is absent | risen |
| Unsafe shutdowns rising | NVMe `unsafe_shutdowns` | risen |
| Time over temperature limit | device statistics 5:80, NVMe warning and critical time | above 0 and risen |

- Interface CRC also becomes a warning fault when it has risen across three or more
  readings in the window (085). The note covers the first two.
- **Link speed below maximum** is not a note. tetanus doesn't know the port's speed, so
  it can't tell a bad cable from an old controller, and a note would need dismissing.
  The disk detail page highlights the negotiated speed where it is below the drive's
  maximum (`linkSpeedCurrentBps` < `linkSpeedMaxBps`), and that is all.
- **FARM 12 V and 5 V rails** are excluded for now. The figures are lifetime minimum and
  maximum, so one old brown-out would show for ever. They stay display only.

### "Risen"

One shared definition for every rule here and in
[097](097-SSD-defect-attributes.md):

- A counter has risen when its latest value is higher than its value at the start of
  the window. Default window 7 days.
- The window needs at least two readings. A disk's first reading is a baseline and
  raises nothing.
- A fall is a counter reset: re-baseline at the lower value, raise nothing.
- A shared helper over attribute history, next to `attributeTrend`.

## Work

1. The shared "risen" helper.
2. Note rules in `server/services/diskNotes.ts` (084).
3. Link speed highlight on the disk detail page; store `linkSpeedCurrentBps` and
   `linkSpeedMaxBps` on the disk if they aren't already.
4. The CRC warning fault: kind `interface-errors`, warning, transient, clears when the
   window passes without a rise.
5. Demo fixtures: zero these counters or drive them from stories, as 084 already warns.

## Questions

1. Window length: 7 days for all, or longer for CRC?

## Progress (2026-10-06)

Built: the "risen" helper (`attributeRise` in `server/services/smart.ts`), the
`interface-errors` fault and the link-speed highlight on the disk page. The fault reads
attribute 199 only: device statistics and FARM keep no per-reading history, so they
can't show a rise. Still to do, once [084](084-Statistics-tab.md) has its notes tier:
the three notes in the table above.
