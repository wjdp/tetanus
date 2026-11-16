---
type: bug
status: todo
---

# Missing vdev_id.conf reported as a failed source

On a host without `/etc/zfs/vdev_id.conf`, the `vdev-id-conf` source fails on every
run and the host page shows it as failed for good, though the file is optional.

## Problem

`collect_vdev_id_conf` in `host/tetanus-collect` runs `cat /etc/zfs/vdev_id.conf`.
When the file doesn't exist, `cat` exits 1 with no output. Since collector 0.6.0
([079](079-Unsupported-OpenZFS-fails-silently.md)), `submit` then posts a failure, and
the server records a failed `CollectorRun` ("Command exited 1: cat:
/etc/zfs/vdev_id.conf: No such file or directory").

In a prod snapshot (2026-11-16), two of four hosts have no `vdev_id.conf`. Each logged
about 4.4k failed runs in 30 days, one per zfs-group run. `SourcesPanel.vue` shows the
source in the error colour with that message.

## Context

- `vdev_id.conf` is optional. It only supplies aliases (`AliasSource
  "vdev-id-conf"` in `server/services/disks.ts`). Most hosts won't have one.
- The collector is meant to stay dumb: no per-source logic beyond running the command
  ([003](003-Architecture-and-data-model.md)).
- The parser is `server/ingest/vdev-id-conf.ts`. An empty body presumably parses to no
  aliases; check.
- Diagnostics (`server/services/diagnostics.ts`) lists `vdev-id-conf` among its
  sources.
- Collector changes need a `version` bump and raise `collector-outdated` on every host
  until it is updated.

## Decisions to make

- Collector side: post an empty body when the file is absent (for example `[[ -r
  /etc/zfs/vdev_id.conf ]]` and otherwise send nothing with status 0), or skip the
  source entirely?
- Or server side: recognise this one failure as "not configured" and show it in
  neutral grey, with no collector change?
- Should the host page show a source that has never succeeded and isn't required
  differently from one that used to work and has stopped?
