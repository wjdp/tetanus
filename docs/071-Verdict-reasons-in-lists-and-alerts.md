---
type: task
status: planned
---

# Verdict reasons in lists and alerts

Stub. A disk's status shows up without its reason everywhere except the attribute
table.

## Problem

Scrutiny's most common complaint is opaque verdicts: about 50 issue titles of the
shape "failed but no attribute failing" (e.g. AnalogJ discussion #886). tetanus
already explains each attribute (reason strings in `shared/smart/evaluate.ts`, shown
in `DiskAttributeDetail.vue`), splits defect from context
([027](027-SMART-status-classification.md)), and uses one policy for the UI and
alerts. But home tiles, the disks list, the Faults page row and alert bodies show a
status without the one-line reason (e.g. "197 pending 16, Backblaze AFR 12 %"). To
find out why, you have to open the disk and read the table.

## Context

- [052 SSD wear monitoring](052-SSD-wear-monitoring.md): the wear column turns amber
  with no fault behind it, the one place tetanus currently shows a colour that no
  verdict explains. Worth landing alongside this.
- Pushover has limited space for the message body; webhook payloads can carry a
  structured reason.
- A disk can have several reasons at once; lists have room for one.

## Questions

1. Which reason wins when there are several: worst severity, newest, or a count
   ("+2 more")?
