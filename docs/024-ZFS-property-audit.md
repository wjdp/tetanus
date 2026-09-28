---
type: task
status: planned
---

# ZFS property audit

Ship `zpool get` and `zfs get` so pool and dataset properties are visible, compared
against a baseline, and their changes land in the diary. Shares the `zfs-get` source
with [015](015-Replication-health.md) and feeds [021](021-Pool-version-diary.md).

## Contract

- Collector: `zpool get -Hp all` (all pools, one call) and `zfs get -Hp -t
  filesystem,volume all`. Both are tab-separated `name property value source` lines;
  `-j` exists on 2.3+ but the text form is stable and one parser covers both. Sent at
  the snapshot cadence (6 h); properties change rarely.
- Sources `zpool-get`, `zfs-get`. Parser: lines → `{ name, property, value, source }`;
  values kept as strings, numeric where `-p` makes them so.
- Storage: `PoolProperty` and `DatasetProperty` (`subjectId`, `property`, `value`,
  `source`, `lastSeenAt`), upsert; changes → diary `property-changed` on the pool or
  dataset with old and new. Pool-level `feature@*` and `version` are what
  [021](021-Pool-version-diary.md) reads.
- Audit: a baseline in settings, a list of `{ property, expected, scope }` rules,
  seeded with the usual suspects: pool `ashift` ≥ 12, `autotrim=on` for SSD-only pools,
  `autoexpand`, all `feature@*` not `disabled` unless `compatibility` is set; dataset
  `compression` not `off`, `atime=off`, `xattr=sa`, `acltype=posixacl`, `recordsize`
  sane for the workload (advisory only). Each rule yields `ok | warn` per subject.
  Inherited values count as set.
- Surface: pool page "Properties" tab with the audit column; dataset page the same;
  a Settings › ZFS audit page to edit rules. No alerts: this is a checklist, not a
  fault.

## Steps

1. Fixtures from mars for both commands.
2. Parser, tests.
3. Persistence, change diary.
4. Rule engine and seed rules, pure, tested.
5. UI tabs and settings page.

## Unanswered questions

1. Should `zfs get all` per dataset replace the `-o <cols>` list in `zfs-list`, or
   stay separate to keep `zfs-list` cheap at 10 min?
2. Which seed rules does the author actually agree with?

## Findings

(agents append here)
