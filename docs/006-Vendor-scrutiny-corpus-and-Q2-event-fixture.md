---
type: task
status: done
---

# Vendor scrutiny corpus and Q2 event fixture

Phase 0 leftovers from [004](004-Project-plan.md) and [005](005-Capture-mars-fixtures.md):
scrutiny's `testdata` SMART corpus under `test/fixtures/scrutiny/`, the Q2 disk's May 2025
failure event capture under `test/fixtures/events/`, and the project's MIT `LICENSE`.

## Findings

- scrutiny's `testdata/` has 18 `*.json` fixtures (plus `helper.go`, not copied), not 19 as
  expected going in.
- Only 7 of the 18 fixtures are asserted on in `smart_test.go`
  (`smart-ata.json`, `smart-fail.json`, `smart-fail2.json`, `smart-ata-failed-scrutiny.json`,
  `smart-nvme-failed.json`, `smart-nvme.json`, `smart-scsi.json`); the other 11 are unused
  by that test file and recorded as `null` in `expected.json`.
- `bin/scrub-fixtures.py` handled the lone `zpool events -v` text file fine: placed as
  `zpool-events.txt` in the raw dir, its `EVENT_GUID` discovery and generic hex-token
  replace picked up the pool/vdev/parent GUIDs and the disk and SAS-expander WWNs without
  any script changes.
- The Q2 pool guid scrubbed, with the default salt, to
  `4620770592528249368` — exactly mars's `tank` `pool_guid` in
  `test/fixtures/mars/zpool-status.json`, confirming pool identity agrees across the two
  fixture sets without manual reconciliation.

## Done when

- `LICENSE` present (MIT, Will Pimblett, 2026).
- `test/fixtures/scrutiny/` has the 18 vendor JSON fixtures, `NOTICE.md` and
  `expected.json`.
- `test/fixtures/events/q2-failure-2025-05.txt` and `README.md` present, scrubbed.
- No original Q2 serial, WWN or pool guid under `test/`.
- All scrutiny fixture JSON parses.
