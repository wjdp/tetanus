# NOTICE

Captured 2026-09-28 with curl (read-only GETs) from the scrutiny instance on mars
(`/api/summary`, `/api/device/<wwn>/details?duration_key=forever`,
`/api/summary/temp?duration_key=forever`). Trimmed to three devices and a handful of
points each; serials and WWNs replaced with the same deterministic fakes as
`test/fixtures/mars` (`bin/scrub-fixtures.py`'s `fake_serial` / `fake_hex`, default salt),
so `details-ata.json` joins mars's `sdb` by WWN and `details-nvme.json` joins `nvme0` by
model and serial. `details-unmatched.json` is a disk not in the mars capture.
