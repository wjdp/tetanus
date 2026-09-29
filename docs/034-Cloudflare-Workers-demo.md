---
type: task
status: todo
---

# Cloudflare Workers demo

A public, no-login demo of tetanus at a fixed URL, running on Cloudflare Workers with a
fleet of fake hosts and disks. Non-primary use case: the Docker container in
[003](003-Architecture-and-data-model.md) stays the product, and nothing here may slow,
complicate or de-risk it. Spec'd 2026-09-29.

Decided 2026-09-29:

- **Runtime: Workers + one Durable Object with SQLite storage.** Not D1: drizzle's D1
  driver is async-only and D1 has no interactive transactions, while the service layer
  is synchronous over better-sqlite3 (158 unawaited query calls, 9 sync
  `db.transaction` blocks including the ingest handler, 100 sync vs 9 async exported
  service functions). Porting to D1 is an async rewrite of `server/`. DO SQLite exposes
  a sync `sql.exec`, so `drizzle-orm/durable-sqlite` is typed `'sync'` like
  `better-sqlite3` and the services run unchanged. The whole Nitro app runs inside the
  DO; fine for a single-user demo.
- **Hourly cron** keeps data current; demo mode relaxes the freshness cadences so nothing
  goes amber between ticks.
- **All in-app edits stay enabled** (inventory, notes, diary, acceptances, host rename,
  `missingAfterDays`). Ingest, scrutiny import, notification channels and healthchecks
  are off; the enrol token is hidden. **Daily reset** wipes everything.
- **Lives in this repo** under `deploy/cloudflare/`, deployed by its own workflow on
  every `master` push, to `tetanus-demo.wjdp.uk` on the author's paid Workers account.
- **The generator is also a supported dev seed** (`pnpm demo:seed` against the local
  dev database), not demo-only.

## Contract

### Demo mode (app, minimal)

`runtimeConfig.public.demo: boolean` (default `false`, set by `NUXT_PUBLIC_DEMO`). One
server helper `server/utils/demo.ts` (`isDemo()`), one composable-free read of
`useRuntimeConfig().public.demo` in the app. Everything demo-specific branches on it;
nothing else in the primary paths changes.

Server, when demo:

| Route / service | Behaviour |
| --- | --- |
| `POST /api/ingest/:source` | 403 `Ingest is disabled in the demo` before token check |
| `POST /api/import/scrutiny`, `POST /api/tasks` | 403 |
| `GET /api/settings` | `enrolToken: "demo"`; notifications always `{ pushover: null, webhook: null }` |
| `PATCH /api/settings` | `notifications` present → 400 `Notification channels are disabled in the demo` |
| `PATCH /api/hosts/:id` | `healthchecksUrl` non-null → 400 |
| `POST /api/alerts/test` | `{ ok: false, error: "Disabled in the demo" }` |
| `dispatch` (alerts), `pingHealthchecks` | return without any outbound request |
| `GET /host/*` (collector script) | 404 |

Freshness: `sourceFreshness` / `groupFor` in `shared/hostFreshness.ts` take an optional
cadence override; demo passes `{ zfs: 60 min, smart: 60 min, snapshots: 6 h }` (the
tick refreshes every source hourly, so the real `zfs` cadence of 10 min would warn after
20 min). Implementer finds the callers in `app/` and `server/services/healthchecks.ts`.

UI, when demo: a persistent banner in the layout ("Demo instance. Fake data, reset daily
at 04:00 UTC. Edit anything."); settings index hides the token and install one-liner;
alerts and import pages show a disabled note instead of forms. No other UI change.

### Fake data generator (`server/demo/`)

Deterministic and pure: `worldAt(t: Date): HostPayloads[]` returns, per host, raw
command output for **every ingest source** in 003's table, exactly as the collector
would POST it. Seeded PRNG (fixed seed) so every reset produces the same fleet; time
enters only through `t`. Seeding and ticking are the same function at different `t`.
All data flows through `recordIngest({ …, receivedAt: t })`, so identity, SMART
evaluation, topology, diary auto events and CollectorRun rows come from the real code
paths, nothing is written to tables directly (exceptions listed under Reset).

Not imported by any route, so it is not in the primary server bundle. Exposed as
`pnpm demo:seed` / `pnpm demo:tick` (tsx, against `DATABASE_URL`, `seed` refuses a
non-empty database unless `--reset`) so the demo can be developed and previewed on the
local dev server without Cloudflare, and as the supported seed for primary dev work:
document it in the README's development section.

**Templates.** Per-model smartctl `--xall` JSON taken from the scrubbed mars fixtures
(`test/fixtures/mars/smartctl/xall-*-auto.json`) plus the SCSI sample in
`test/fixtures/synthetic-smartctl/`. The generator substitutes: serial (vendor formats:
Seagate `ZL2` + 5 alnum, WD `WD-WX` + 9 / `9JH…`, Samsung `S5…NX0N…`, Intel `BTYF…`,
NVMe `eui.` WWN), WWN prefixes per vendor (`5000c500`, `50014ee2`, `5002538e`), firmware,
`power_on_time.hours` from purchase date, power cycles, temperature (per-host ambient +
daily sine + noise), attribute raw values (5/197/198 zero except story disks; 9, 4, 12,
190, 194, 241/242 consistent with hours and usage; SSD 177/179/241; NVMe
`percentage_used`, `data_units_written`, `media_errors`), `ata_sct_temperature_history`
matching the curve, self-test log (short weekly, long monthly). `lsblk`, `udev`,
`by-id`, `vdev_id.conf`, `zpool-status/list`, `zfs-list`, `zfs-snapshots`,
`zpool-history`, `zpool-events` and `versions` are rendered from the fleet model with the
same field shapes as the mars fixtures.

**Fleet** (names are fake; numbers approximate):

| Host | Role | Pools | Disks |
| --- | --- | --- | --- |
| `atlas` | main NAS, Ubuntu, OpenZFS 2.4 | `tank` 2 × raidz2 (6 wide) 16–18 TB Exos + WD Ultrastar, `special` mirror 2 × 870 EVO 2 TB; `rpool` mirror 2 × SATA SSD; `scratch` single NVMe | 17 |
| `styx` | backup box, Debian | `vault` raidz1 × 4 WD Red Plus 8 TB + hot spare; `rpool` single SSD | 6 |
| `pip` | mini PC, Ubuntu | `rpool` mirror 2 × NVMe; one ext4-on-LUKS disk outside ZFS (028's usage view) | 3 |

Plus inventory-only rows: three disks with `sold` / `retired` / `dead` overrides and
prior history, so the lifecycle filter has something to show. Aliases follow the
`A1…`, `V1…`, `P1…` cohort scheme. Inventory spread 2019–2026: purchase dates, GBP
prices, suppliers (Scan, Amazon, eBay, Bargain Hardware), conditions including two
shucked WD120EMAZ with `pin33Taped`, warranties with one expiring next month.

Datasets: `tank/media/{films,tv,music}`, `tank/photos`, `tank/home/{ada,ben}`,
`tank/backups/{styx,pip,laptops}`, `tank/vm/*` zvols, `vault/replica/tank/*` (snapshot
GUIDs shared with `tank`, feeding [015](015-Replication-health.md) later). Snapshots in
sanoid (`autosnap_2026-09-28_00:00:00_daily`) and `zfs-auto-snap_hourly-…` styles,
hourly/daily/monthly retention, ~1500 total. `zpool history` with create/add/replace/
scrub/set lines; `zpool events` with a few checksum ereports and state changes.

**Stories** (each is a function of `t`, so they play out over the replay and continue
ticking):

1. `A3`: pending sectors 8, accepted at 8 six months ago, stable → accepted overlay.
2. `A7`: reallocated sectors climbing 0 → 24 over the last 30 d, checksum ereports →
   unaccepted failed attribute, worsening trend, diary events.
3. `V2` failed last month and was replaced by `V6`: disk-appeared, vdev-left/joined,
   resilver, `V2` overridden `dead` with a manual diary entry.
4. `tank` scrub in progress at reset (~40 %), completing over the next ticks; `vault`
   scrubbed last Sunday, 0 errors.
5. `P1` NVMe at 87 % `percentage_used` → endurance story for [019](019-SSD-endurance.md).
6. `V5` (hot spare) pulled a week ago → `missing`.
7. Manual diary entries and host notes in markdown, a few per subject.

**Replay schedule at reset** (`seed(now)`): for each disk, monthly SMART from its
install date to `now − 90 d`; daily from there to `now − 48 h`; hourly for the last
48 h (7 d and 30 d trend windows and sparklines need real points). ZFS sources at every
story instant plus daily. Snapshots and datasets only at the end (upsert; creation dates
carry the history). After replay, `listDisks(now)` materialises state transitions (those
emitters stamp `now`, not `receivedAt`), then the manual diary entries, acceptances and
overrides are applied through the services with backdated `at`. Finally a handful of
`Notification` rows are inserted directly (channel `pushover`, `ok: true`, backdated)
for the story alerts (`A7` attribute-failed, `V2` disk-failed, `V5` disk-missing,
`vault` pool-degraded and recovered) so Settings › Alerts has history; the only direct
table write in the seed. Budget: ~30 disks ×
~250 readings ≈ 7500 `smartctl-xall` ingests; must complete in well under the DO CPU
limit (30 s default). Measure in the spike; chunk with DO alarms if needed.

**Tick** (`tick(now)`): `worldAt(now)` for every host, ingest every source with
`receivedAt = now`. Idempotent for a given hour.

Tests: every generated payload parses through `PARSERS[source]` without error;
determinism (`worldAt(t)` twice is deep-equal); one seeded in-memory DB asserts host,
disk, pool, dataset and snapshot counts and that each story disk lands in the expected
state/status. No fixture files are added; templates are read from the existing ones.

### Cloudflare layer (`deploy/cloudflare/`)

```
deploy/cloudflare/
  nuxt.config.ts     Nuxt layer applied when TETANUS_TARGET=cloudflare
  worker.ts          Worker entry: fetch → DO, scheduled → DO; exports the DO class
  client.ts          db shim over drizzle-orm/durable-sqlite (aliased over server/database/client)
  migrate.ts         runMigrations shim using the bundled migrations (aliased over server/database/migrate)
  migrations.ts      generated: journal + SQL from server/database/migrations
  wrangler.jsonc
  tsconfig.json      @cloudflare/workers-types
```

- **Nuxt layer.** `nuxt.config.ts` gains one conditional line:
  `extends: process.env.TETANUS_TARGET === "cloudflare" ? ["./deploy/cloudflare"] : []`.
  The layer sets `nitro.preset: "cloudflare-module"`, `nitro.alias` for the two shims,
  `nitro.scheduledTasks: {}` (crons are dispatched by `worker.ts`), `runtimeConfig.public.demo: true`,
  and `nitro.ignore` for `server/routes/host/**`. Primary build untouched.
- **Worker.** Static assets from `.output/public` via Workers Static Assets, served
  before the Worker runs. Every other request → `env.DEMO.idFromName("demo")`. Cron
  triggers `0 * * * *` (tick) and `15 4 * * *` (reset) call internal DO methods via RPC
  (`stub.tick()`, `stub.reset()`), never over a public path.
- **Durable Object.** Constructor, inside `blockConcurrencyWhile`: bind
  `drizzle(ctx.storage, { schema })` into `client.ts`, run bundled migrations,
  `ensureSettings()`, `applySmartPolicyIfStale()`, seed if `Host` is empty. `fetch`
  lazily imports the built Nitro handler (`.output/server/index.mjs`) after the db is
  bound and calls `nitro.fetch(request, env, ctx)`. The Nitro migrate plugin then runs
  against the shim and is a no-op.
- **db shim.** `export const db` is a Proxy forwarding to the bound drizzle instance;
  `sqlite` exposes `prepare(sql).get()` over `storage.sql.exec` for `/health`.
  `Db` type stays.
- **Migrations bundle.** Generated at build from `server/database/migrations/meta/_journal.json`
  and the SQL files into the shape `drizzle-orm/durable-sqlite/migrator` expects; try
  drizzle-kit's `driver: "durable-sqlite"` output first, fall back to a 30-line script.
  The migrate shim mirrors `migrateWithoutForeignKeyEnforcement` if DO SQLite honours
  `PRAGMA foreign_keys`; otherwise document the difference.
- **Reset.** `storage.deleteAll()` (SQL and KV), then the constructor sequence. Viewers
  block for the seed duration. Also runs on the first request after a deploy that finds
  no `Host` rows.
- **wrangler.jsonc.** `main`, `assets: { directory: ".output/public" }`,
  `compatibility_flags: ["nodejs_compat"]`, DO binding `DEMO` → class `TetanusDemo`
  with `new_sqlite_classes`, `triggers.crons`, `vars.NUXT_PUBLIC_DEMO`,
  `limits.cpu_ms: 300000` (paid plan), a `ratelimits` binding, and `routes` for
  `tetanus-demo.wjdp.uk` (zone `wjdp.uk`).
- **Scripts.** `pnpm build:demo` (`TETANUS_TARGET=cloudflare nuxt build` + migrations
  bundle), `pnpm demo:dev` (`wrangler dev`, Miniflare supports DO SQLite locally),
  `pnpm demo:deploy`. Workflow `demo.yml`: on push to `master` after `checks`, build and
  `wrangler deploy` with `CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ACCOUNT_ID` secrets.
- **Lint/typecheck.** `deploy/cloudflare/` is Biome-checked; its own tsconfig is
  type-checked in `checks.yml`. The primary `nuxt typecheck` ignores it.

### Runtime constraints to verify in the spike

Time-box the spike; if it fails, fall back to Cloudflare Containers running the existing
image behind the same Worker and cron (paid plan, cold starts, ephemeral disk makes
reset a restart).

- Nuxt `cloudflare-module` output imported and called from inside a DO, with `env`
  and a `ctx` shim (`waitUntil`).
- `drizzle-orm/durable-sqlite`: sync `transaction`, `json_extract`, `PRAGMA foreign_keys`
  / `foreign_key_check` availability, `returning()`.
- `nodejs_compat` covers `node:crypto` (`createHash`, `createHmac`, `randomBytes`,
  `timingSafeEqual`) and `Buffer`.
- `useStorage()` (queue) resolves to the memory driver in this preset; losing it on
  isolate eviction is harmless.
- SSE (`createEventStream`) through the DO; connection and duration limits on the plan.
- Seed CPU time against the DO limit; chunk with alarms if needed.
- Worker bundle size (3 MB compressed free / 10 MB paid) with `nasdisks.json` and
  `shared/smart/metadata.json` inlined.
- Server assets (`assets:host`) are excluded rather than shipped.

### Abuse surface

Public writes are bounded by the existing zod limits (notes 100 kB, diary bodies).
`markdown-it` must run with `html: false` (verify). Rate limiting is committed in
`wrangler.jsonc` as a Workers rate-limiting binding (`ratelimits`, keyed on client IP,
e.g. 60 writes / 60 s) and enforced in `worker.ts` for `PATCH|POST|DELETE /api/*`
before forwarding to the DO: 429 with a short JSON body. The daily reset is the
cleanup. No secrets exist in the demo: channels are off, token hidden, no outbound
requests.

## Order of work

1. Generator, demo mode, `pnpm demo:seed` on the local dev server. Visible result
   without Cloudflare; the seed is useful for primary development on its own.
2. Spike the DO runtime with a hello-world route, then the full app. Decide.
3. Worker entry, crons, reset, wrangler config, workflow, domain.
4. Banner, route gating, freshness override, rate limit, README seed docs.

## Answered 2026-09-29

1. Domain `tetanus-demo.wjdp.uk`, author's personal Cloudflare account.
2. Paid Workers plan: `limits.cpu_ms` raised, 10 MB bundle, no free-tier DO limits.
3. Fleet and story names as spec'd.
4. Reset daily 04:00 UTC; edits live up to 24 h.
5. Seed `Notification` rows for the story alerts.
6. Deploy from every `master` push.
7. `pnpm demo:seed` is a supported dev seed, documented for primary development.
8. Rate limiting committed in `wrangler.jsonc` via the rate-limiting binding.
9. Demo is indexable: no `robots.txt` disallow, no `noindex`.
