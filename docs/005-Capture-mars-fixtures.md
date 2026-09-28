---
type: task
status: done
---

# Capture mars fixtures

Phase 0 of [004](004-Project-plan.md): real command output from mars, scrubbed, committed
under `test/fixtures/mars/` so every Phase 2 parser is written against the truth.

## Scope

1. `bin/capture-fixtures.sh`: run as root on mars, read-only. One file per source from
   the table in [003](003-Architecture-and-data-model.md) plus tool versions, nested
   `zpool status -j` shape, `zpool history -il` tail, `zpool events -vH`, udev data per
   disk and partition, `smartctl --xall --json -n standby` for every scanned device.
   Exit status recorded per command; non-zero is data (standby disks exit 2).
2. `bin/scrub-fixtures.py`: rewrites serials (attached and absent disks, via by-id
   tokens), WWNs and EUI-64s (OUI kept; SAS expander and phy addresses included), pool
   and vdev GUIDs (decimal and `0x` hex forms), hostnames other than mars, dataset path
   components below the pool, and partition/filesystem UUIDs with deterministic
   same-shape fakes, consistently across all files. Truncates the snapshot list, keeps
   the count. Fails if any original identifier survives.
3. Author runs it on mars, eyeballs the output, commits.

## Findings

- `zpool status -j -L` resolves alias paths and drops `guid`/`path`/`devid`/`state`
  from leaf vdevs. Captured with and without `-L`, plus `-g` and plain text; 003 updated.
- `smartctl --scan` reports `-d scsi` for SATA behind the LSI HBA; a `-d`-less run is
  captured alongside so the SAT payload is not lost.
- First scrub pass leaked serials of detached disks (`vdev_id.conf`), the NVMe EUI-64
  pair, SAS expander and phy addresses; all fixed and covered by post-checks.

## Deviations from the plan

- All disks captured, not one per model family: `-n standby` makes it free and a
  superset costs nothing to prune later.
- Scrubber is python3 (stdlib), not bash: JSON must stay valid and the WWN split in
  smartctl output must be recomputed.

## Not in scope

- Scrutiny `testdata` copy and the Q2 failure event capture (plan steps 3 and 4).
- Licence for publication (plan open question 2) must be settled before push.

## Done when

- Scripts in `bin/`, shellcheck clean.
- `test/fixtures/mars/` committed with `manifest.txt` and no real identifiers.
