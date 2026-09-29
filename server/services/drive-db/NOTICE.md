# Drive spec data: attribution

`nasdisks.json` is a trimmed snapshot of <https://www.nasdisks.com/data/drives.json>,
refreshed by `bin/update-drive-db.sh`. It is never fetched at runtime.

- **Drive specs and CMR/SMR classification**: by [nasdisks.com](https://www.nasdisks.com/data),
  licensed [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). Changes: acoustic
  fields and Backblaze drive-day and failure counts removed; rows sorted by model.
- **Failure rates** (`afr_pct`, `reliability_drive_count`, `reliability_source`):
  [Backblaze Drive Stats](https://www.backblaze.com/cloud-storage/resources/hard-drive-test-data),
  as aggregated per model by nasdisks.com. Free to use with attribution to Backblaze; the
  data itself may not be sold. Backblaze does not endorse this project.

`overrides.json` is hand-written by this project from manufacturer datasheets for models
the dataset lacks.
