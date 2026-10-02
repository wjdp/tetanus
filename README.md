# <img src="https://raw.githubusercontent.com/wjdp/tetanus/refs/heads/master/public/favicon.svg" height="22" /> tetanus

A self-hosted disk and ZFS monitor for a home NAS. It tracks every disk the NAS has ever had: SMART health with scrutiny's attribute knowledge, lifecycle and inventory, ZFS pool topology, and a diary of what happened to each disk. A small host-side collector (bash, a systemd timer and a ZED hook) posts raw `smartctl`, `zpool` and `zfs` output to one unprivileged container, which does all the parsing.

**Status:** alpha. Working and being used on my own NAS but not quite ready yet.

Design and plans are in [docs/](docs/000-Docs.md).

## Development

Node 24 and pnpm 12. `pnpm install`, then:

- `pnpm dev`: Nuxt dev server on http://localhost:3000, against `./dev.db` (override with `DATABASE_URL`).
- `pnpm db:migrate`: apply migrations. Dev does not migrate on boot; the production image does.
- `pnpm demo:seed`: fill the database with the demo fleet, the supported seed for development. It replays about seven years of collector runs through the real ingest path (roughly a minute), so identity, SMART evaluation, topology and the diary come from the same code as real data. Refuses a database that already has hosts or disks; `--reset` deletes every row first (the file stays, so a running `pnpm dev` keeps working). `--now <iso>` pretends it is another instant. Needs `.nuxt/`, which `pnpm dev` generates.
- `pnpm demo:tick`: one collector run per host for the current hour, as the hourly collector would post. Repeating it within the hour does nothing.
- `pnpm test`: Vitest, unit tests then e2e route tests. `pnpm lint` and `pnpm typecheck` before committing.

The demo fleet is three hosts: `atlas` (main NAS: `tank` of two six-wide raidz2 vdevs plus a special mirror, an `rpool` mirror and a single-NVMe `scratch`), `styx` (backup box: `vault` raidz1 with replicas of tank's datasets) and `pip` (mini PC: NVMe `rpool` mirror and a LUKS/ext4 disk outside ZFS). Stories to look at: A3's pending sectors accepted, A7's reallocated sectors climbing with checksum errors, V2 failed and replaced by V6, `tank` mid-scrub, P1 near the end of its rated endurance, V5 (vault's hot spare) pulled and missing, three sold/retired/dead disks in the inventory, and a few alert notifications in Settings › Alerts.

### Fault simulator

In dev and the demo, the disk page, pool page and hosts table have a "Simulate fault" menu (flask icon) that injects a fake fault through the real ingest path: pending sectors, SMART health failed, a degraded pool, a silent collector and so on. Scenarios with parameters open a form with defaults; Enter runs them. While a simulation is active every database write is logged, and Restore (in the menu or the banner) rolls the whole database back to before the first simulation, including anything else that changed since. Alerts are recorded but not sent meanwhile. Elsewhere it is off; `NUXT_PUBLIC_FAULT_SIMULATOR=true` turns it on, but only on a database you can afford to roll back. See [044](docs/044-Fault-simulator.md).

### Cloudflare demo

The public demo runs the same app in a Durable Object (see [034](docs/034-Cloudflare-Workers-demo.md)), reseeded daily at 04:15 UTC and ticked hourly.

- `pnpm build:demo`: build for Cloudflare (`TETANUS_TARGET=cloudflare`).
- `pnpm demo:dev`: run the build locally with `wrangler dev`.
- `pnpm demo:deploy`: deploy with `wrangler deploy`; CI does this from `master`.

## Licence

MIT, see [LICENSE](LICENSE).
