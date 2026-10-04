---
type: task
status: planned
---

# Collector device exclusion and type override

Stub. Some disks need a smartctl `-d` type that `--scan` doesn't give, and some devices
shouldn't be monitored at all.

## Problem

The collector reads every device that `smartctl --scan` returns, passing `-d` only for
types that need addressing (`needs_device_type` in `host/tetanus-collect`). Disks
behind USB bridges often need `-d sat` (or a vendor-specific type) to return SMART
data; without it they show up with nothing or not at all. The author has one USB disk
on a Pi host: USB isn't preferred, but sometimes it's needed. The opposite case
also exists: devices that are scanned but aren't worth monitoring (an SD card, virtual
disks).

Scrutiny handles both in its collector config (`devices` list with type, ignore
list); its fork has open requests for pattern exclusion and virtual-disk detection
(Starosdev #913, #912). Controller and USB passthrough is a recurring scrutiny
complaint (AnalogJ#4, 47 comments).

## Context

- The collector has no configuration beyond URL and token, by design
  ([001](001-Product-goals.md)); `collect.env` is the only host-side file.
- An empty smartctl result is logged on the host ("skipped, no output") and never
  posted, so the server can't tell "unreadable" from "absent" until the disk goes
  missing.
- Exclusion could live on the server (ignore this disk) rather than in the collector.

## Questions

1. Server-side or host-side configuration for each half?
