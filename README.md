# <img src="https://raw.githubusercontent.com/wjdp/tetanus/refs/heads/master/public/favicon.svg" height="22" /> tetanus

> [!WARNING]
> tetanus **is not stable yet**. It runs on my own NAS but I've not yet made a stable release.

A self-hosted disk and ZFS monitor for home NAS hosts. tetanus answers three questions: **is a disk failing**, **is ZFS upset**, and **what is this disk, where is it and what has happened to it**.

SMART dashboards tell you how a disk is doing today. A spreadsheet tells you what you bought and when. Neither remembers that the disk in bay 3 was the one you pulled from the backup box after it threw pending sectors, got accepted at 16, and was swapped for the RMA replacement last autumn. tetanus keeps the whole story: every disk you've used, across every host, from when you bought it to when you threw it away.

A small read-only collector on each host (bash, three systemd timers and a ZED hook) posts raw `smartctl`, `zpool` and `zfs` output to one unprivileged container. All your hosts can report to that one server, if you move a disk between hosts the stats are preserved. The container never touches a block device and the collector never writes to the host.

tetanus is single-user per instance, built by the author for the author and published for others to self-host. There is a public demo at <https://tetanus-demo.wjdp.uk>.

## Features

- **SMART health** — every attribute with history, trend and an explanation of what it means, using [scrutiny](https://github.com/AnalogJ/scrutiny)'s attribute knowledge and Backblaze failure-rate context. Self-tests, temperature, power-on time and drive specs.
- **Faults you can accept** — a flaky attribute is accepted at its current value and stays quiet until it gets worse. Acceptances and acknowledgements go in the diary.
- **ZFS topology** — pools, vdevs and disks with health, error counters, scrub and resilver state, capacity and fragmentation. Datasets and snapshots, read-only. Archived and missing pools stay visible.
- **Replication health** — datasets replicated between hosts are paired by snapshot GUID, with lag, stalled and destroyed targets surfaced as faults.
- **Disk lifecycle** — in-use, spare, removed, dead, retired, inferred from ZFS membership and presence, overridable by hand. A disk moving between hosts is noticed. Disposal (sold, RMA'd, recycled) keeps the history and alerts if the disk is ever seen again.
- **Inventory** — aliases that are the disk's name everywhere, purchase date, price, supplier, condition, warranty expiry, notes. Age as calendar time and power-on hours. Disks outside ZFS are tracked too.
- **Diary** — per-disk and per-pool timeline of manual markdown entries and automatic events: appeared, vanished, moved host, joined or left a pool, attribute changed, scrub finished, resilver, state change.
- **Alerts** — Pushover and webhook on new faults, missing or reappeared disks, pools not ONLINE, scrubs with errors, and a recovery notice when a fault clears. Optional healthchecks.io ping per host so a silent collector is itself an alert.
- **Hosts** — per-host collector health, outdated collectors flagged, intermittent hosts tolerated.
- **Import** — one-off import of devices and attribute history from a running [scrutiny install](https://github.com/AnalogJ/scrutiny).

On the roadmap (see [`docs/004-Project-plan.md`](docs/004-Project-plan.md)): scrub and self-test overdue, snapshot staleness, kernel log ingest so a bad cable is not mistaken for a bad disk, capacity forecast, SSD wear, warranty nudges with an RMA sheet, ZFS property audit and pool version diary.

## Installation

tetanus is a Node server with a SQLite database. Everything it stores lives in one data directory, which you mount as a volume. **Back this directory up**; SMART history and the diary cannot be re-fetched.

Hosts need OpenZFS 2.3+ (JSON output) and smartmontools 7.4+, which is Ubuntu 26.04 or similar. The install script will check that for you.

### Docker Compose

Docker Compose is the only supported deployment method. Adapt the following for your stack:

```yaml
services:
  tetanus:
    image: ghcr.io/wjdp/tetanus:latest
    container_name: tetanus
    restart: unless-stopped
    user: "1000:1000"
    volumes:
      - <path to local directory>:/app/data
    ports:
      - 3000:3000
    environment:
      - TZ=Europe/London
```

The container runs as whatever `user` you give it; `1000:1000` is the usual first user on a Linux host, so check with `id -u` and `id -g` and make sure the data directory is owned by that user, or tetanus will fail to create its database.

Then pull and bring up the container

```bash
docker compose pull
docker compose up -d
```

Then open <http://your-host:3000>.

I assume as you're self hosting you have a nice reverse proxy you can wrap tetanus with so you get HTTPS and a proper domain.
Adapt the above as needed for your setup. Search online for "docker compose reverse proxy" if you need a hand.

### Enrolling hosts

The first-run page and Hosts → Add host show the install command with your enrol token. On each host you want to monitor, run it as root:

```sh
curl -fsSL https://tetanus.example/host/install.sh \
  | sudo bash -s -- --url https://tetanus.example --token <enrol token>
```

It installs the collector, timers and ZED hook, then collects once so the host shows up straight away. ZFS state is collected every 10 minutes, SMART and snapshots hourly, ZFS events as they happen. The collector runs read-only against the host and sends the token in a header, never on a command line. Details, checks and uninstall in [`host/README.md`](host/README.md).

### Protecting your install

tetanus is designed as a single-user service and has **no authentication at all** beyond the collector's enrol token; if you expose it on an untrusted network **you** are responsible for protecting it.

In simple terms: use it on your home network, don't open it up to the internet. Use a VPN (e.g. Tailscale) for remote access.

### Installing on a phone

tetanus can be added to a home screen and opens as a standalone app. On Android, Chrome menu → Install app; on iOS, Share → Add to Home Screen. There is no offline mode: it needs to reach the server.

Android and desktop Chrome only offer a proper install over HTTPS; over plain HTTP on a LAN you get a bookmark-style shortcut instead. iOS installs over HTTP. If your reverse proxy adds auth, the manifest is fetched with credentials so it still loads.

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

The stack is Nuxt 4 (Vue, Nuxt UI, Tailwind) with a Nitro server, Drizzle ORM on better-sqlite3, parsers in `server/ingest/` and the collector in `host/`. Working docs — plans, reviews and reference material — live in [`docs/`](docs/000-Docs.md).

## Licence

MIT, see [LICENSE](LICENSE).
