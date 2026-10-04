---
type: task
status: planned
---

# Disk identify light

Stub. The one host action worth having: blink the locate LED on a disk so the right
one gets pulled.

## Problem

[001](001-Product-goals.md) rules out writing to the host in v1: no self-tests,
scrubs or `zpool clear`. A locate light is a write in the narrow sense but changes
nothing about the data or the pool, and it answers the question tetanus leaves the
user with at the worst moment: "which physical disk is `K3`?". Nice to have, not
required.

## Context

- Depends on knowing the enclosure slot: [061 Physical bay
  mapping](061-Physical-bay-mapping.md), whose `Enclosure` rows carry the sysfs name and
  element per slot. Verified on mars: writing `1` to
  `/sys/class/enclosure/<enc>/ArrayDevice08/locate` lights bay 1 through passive
  backplanes behind an Intel RES2SV240 expander. A disk without an SES slot has no light to
  blink (motherboard SATA, most USB enclosures, most consumer NAS cases).
- Mechanisms: write `1` to `/sys/class/enclosure/<enc>/<slot>/locate`; `sg_ses
  --dev-slot-num=N --set=locate <sg device>`; `ledctl locate=/dev/sdX` (Intel
  `ledmon`, SGPIO and SES). OpenZFS's own `zpool_ledctl`/`statechange-led.sh` zedlet
  uses the sysfs path from `vdev_enc_sysfs_path`, which is a working reference for
  which files to touch.
- The collector is strictly one-way today: it POSTs, never polls. An action needs a
  channel from server to host: the collector polling for pending actions on its next
  run (slow, minutes), a long-poll, or the user running a command the server shows
  them (`tetanus-collect --locate K3`, no new channel at all). The last fits the
  read-only posture and the "never automated over SSH" decision in
  [003](003-Architecture-and-data-model.md).
- The systemd unit runs with `ProtectSystem=strict`; `/sys` writes would need an
  exception or a separate unit.
- The light needs turning off again.

## Questions

1. Server-triggered or a command tetanus tells you to run on the host?
2. Is this the thin end of the actions wedge, and does it need the feature flag the plan's Later section describes?
