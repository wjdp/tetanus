---
type: task
status: planned
---

# Pool version diary

Stub. Record ZFS version and feature-flag changes against the pool, not the host:
the pool is what carries the on-disk format and what the author cares about when
something changes. After Phase 5 ([004](004-Project-plan.md)).

## Sketch

- Source: `zpool get -Hp all <pool>` (shared with [024](024-ZFS-property-audit.md))
  for `version`, `feature@*` states, `compatibility`; plus the `versions` source
  already shipped (`zfs`, `kernel`) attributed to the pool via its host at ingest
  time.
- Store the last seen value per pool per key; on change, diary auto events on the
  pool: `pool-upgraded` (`version` or a feature moving `disabled → enabled → active`),
  `pool-zfs-version-changed` ("tank now served by OpenZFS 2.4.2 on kernel 7.2"),
  `pool-moved` already exists.
- Surface: pool page diary; a "features not enabled" note when `zpool status`
  reports upgradable features (it prints a `status` line for this).
- No host-level version diary; the host record keeps only current `toolVersions`.

## Unanswered questions

1. Is a feature flag flipping `enabled → active` diary-worthy, or only explicit
   `zpool upgrade`?
