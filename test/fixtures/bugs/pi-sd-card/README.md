# tetanus diagnostics for disk 30

Generated 2026-09-29T20:03:03.749Z.

- `meta.json`: app version, schema migration, settings that affect state.
- `db/`: what tetanus has stored about the disk. Readings cover the last 30 days.
- `raw/pihost/`: the latest collector output from pihost for every disk on the host, byte for byte. `manifest.json` lists each file with its source, device, type, exit status and receipt time.

Contains serials, hostnames and mount paths. Check before posting publicly.

## Replay

Unzip into `test/fixtures/bugs/<name>/` and, in a unit test:

```ts
import { replayBundle } from "~~/test/diagnostics";

replayBundle(join(import.meta.dirname, "../../test/fixtures/bugs/<name>"));
```

This ingests `raw/<host>/` in collector order into the test database; then
assert on the disk.
