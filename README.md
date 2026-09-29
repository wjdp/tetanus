# tetanus

A self-hosted disk and ZFS monitor for a home NAS. It tracks every disk the NAS has ever had: SMART health with scrutiny's attribute knowledge, lifecycle and inventory, ZFS pool topology, and a diary of what happened to each disk. A small host-side collector (bash, a systemd timer and a ZED hook) posts raw `smartctl`, `zpool` and `zfs` output to one unprivileged container, which does all the parsing.

**Status:** pre-alpha. Nothing works yet.

Design and plans are in [docs/](docs/000-Docs.md).

## Development

Node 24 and pnpm 12. `pnpm install`, then:

- `pnpm dev`: Nuxt dev server on http://localhost:3000, against `./dev.db` (override with `DATABASE_URL`).
- `pnpm db:migrate`: apply migrations. Dev does not migrate on boot; the production image does.
- `pnpm demo:seed`: fill the database with the demo fleet, the supported seed for development. It replays about seven years of collector runs through the real ingest path (roughly a minute), so identity, SMART evaluation, topology and the diary come from the same code as real data. Refuses a database that already has hosts or disks; `--reset` deletes every row first (the file stays, so a running `pnpm dev` keeps working). `--now <iso>` pretends it is another instant. Needs `.nuxt/`, which `pnpm dev` generates.
- `pnpm demo:tick`: one collector run per host for the current hour, as the hourly collector would post. Repeating it within the hour does nothing.
- `pnpm test`: Vitest, unit tests then e2e route tests. `pnpm lint` and `pnpm typecheck` before committing.

The demo fleet is three hosts: `atlas` (main NAS: `tank` of two six-wide raidz2 vdevs plus a special mirror, an `rpool` mirror and a single-NVMe `scratch`), `styx` (backup box: `vault` raidz1 with replicas of tank's datasets) and `pip` (mini PC: NVMe `rpool` mirror and a LUKS/ext4 disk outside ZFS). Stories to look at: A3's pending sectors accepted, A7's reallocated sectors climbing with checksum errors, V2 failed and replaced by V6, `tank` mid-scrub, P1 near the end of its rated endurance, V5 (vault's hot spare) pulled and missing, three sold/retired/dead disks in the inventory, and a few alert notifications in Settings › Alerts.

### Cloudflare demo

The public demo runs the same app in a Durable Object (see [034](docs/034-Cloudflare-Workers-demo.md)), reseeded daily at 04:15 UTC and ticked hourly.

- `pnpm build:demo`: build for Cloudflare (`TETANUS_TARGET=cloudflare`).
- `pnpm demo:dev`: run the build locally with `wrangler dev`.
- `pnpm demo:deploy`: deploy with `wrangler deploy`; CI does this from `master`.

## Licence

MIT, see [LICENSE](LICENSE).
