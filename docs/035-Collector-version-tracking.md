---
type: task
status: in-progress
---

# Collector version tracking

The server cannot tell which collector each host runs, so a host left on an old
collector silently loses data when a parser starts depending on newer output (as 033's
lsblk `ZONED`, `LOG-SEC` and `PHY-SEC` did in collector 0.3.0). Spec'd 2026-09-29.

Decided 2026-09-29: an outdated collector shows on the hosts page only; an incompatible
one is a fault and an alert, since its stats are no longer being collected. No
self-update (see Out of scope).

## What exists

- `host/tetanus-collect` sends `User-Agent: tetanus-collect/<version>`; ingest stores it
  per run as `CollectorRun.producer`. Nothing reads it back.
- The server bundles `host/` as the `assets:host` storage and serves it at `/host/<file>`,
  so each server build ships exactly one collector version: the latest.
- Re-running `curl -fsSL <url>/host/install.sh | sudo bash` with no arguments upgrades a
  host in place: `install.sh` reads `TETANUS_URL` from the existing `collect.env` and
  leaves the config alone. No token needed.
- `host/zed/all-tetanus.sh` sends `User-Agent: tetanus-zed`, no version.

## Contract

### Versions (`shared/collector.ts`)

```ts
export const COLLECTOR_VERSION = "0.3.0";          // what this server ships
export const MIN_COLLECTOR_VERSION = "0.3.0";      // oldest whose output parses fully
export type CollectorStatus = "current" | "outdated" | "incompatible" | "unknown";
export function collectorStatus(version: string | null): CollectorStatus;
export function parseCollectorProducer(producer: string | null): string | null;
```

- `collectorStatus`: null or unparseable → unknown; `< MIN` → incompatible; `< COLLECTOR`
  → outdated; else current. A version newer than `COLLECTOR_VERSION` (server older than
  host) is current.
- Compare `major.minor.patch` numerically in a small local function; no `semver`
  dependency for three integers.
- `parseCollectorProducer` matches `^tetanus-collect/(\d+\.\d+\.\d+)$`; anything else
  (including `tetanus-zed`) → null.
- A co-located test reads `host/tetanus-collect` and asserts its `readonly version=` equals
  `COLLECTOR_VERSION`, so the two cannot drift. No build-time templating.
- Bump `MIN_COLLECTOR_VERSION` by hand when a parser or service stops handling an older
  collector's output. Tasks that bump the collector version must say whether they also
  bump the minimum.

### Storage

- `Host.collectorVersion: text()` nullable and `Host.collectorStatus: text()` (a
  `CollectorStatus`, default `unknown`). Migration `host_collector_version`, backfilling
  the version from each host's latest `CollectorRun.producer` that parses; status is
  left `unknown` so the first ingest after deploy records the transition.
- `recordIngest` sets the version from `parseCollectorProducer(producer)` when non-null.
  Latest run wins (a downgrade is reported as such). ZED runs never touch it.
- On every ingest with a parsed version, recompute `collectorStatus(version)` and compare
  with the stored status, not the stored version: a server upgrade that raises
  `MIN_COLLECTOR_VERSION` makes a host incompatible without its version changing. On a
  change, store it and record the diary event below.

### Diary

Auto entry, subject `host`, eventType `collector-status-changed`, data
`{ from, to, version, minVersion }` (`from`/`to` are statuses). Title e.g.
`Collector 0.2.0 incompatible (needs 0.3.0)`, `Collector upgraded to 0.3.1`. Not
recorded for `unknown → current` or `unknown → outdated`, so first deploy does not flood
the diary.

### Alerts (026)

Two new rules in `ALERT_RULES` (`shared/alerts.ts`), mapped in `server/services/alerts/rules.ts`:

| eventType | condition | rule | severity |
| --- | --- | --- | --- |
| `collector-status-changed` | `to === "incompatible"` | `collector-incompatible` | alert |
| `collector-status-changed` | `from === "incompatible"` and `to` current/outdated | `collector-compatible` | recovery |

Labels "Collector incompatible", "Collector compatible again". Dedupe `value` is the
version. `AlertContext` gains `host(id)` for the subject text (`mars · collector`);
message `mars · collector: 0.2.0 is too old; tetanus needs 0.3.0 or later`.
- `/api/hosts` and `/api/hosts/[id]` return `collectorVersion`.

### Hosts page (`app/pages/settings/hosts.vue`)

- A collector column: the version, plus a badge for anything other than current:
  outdated (amber, "0.3.0 available"), incompatible (red), unknown (neutral).
- Outdated or incompatible hosts show the upgrade command, copyable, built like
  `InstallCommand.vue` but without `--url`/`--token`:
  `curl -fsSL <server url>/host/install.sh | sudo bash`.

### Fault (`app/composables/useFaults.ts`)

- An incompatible host adds a fault, id `collector-incompatible:<host>:<version>` so an
  upgrade to another incompatible version shows it again after a dismissal.
- Title: `<host> collector <version> is too old; tetanus needs <MIN> or later`.
  Description: the upgrade command.
- Outdated and unknown add no fault.

### Collector

- `host/zed/all-tetanus.sh` sends `tetanus-zed/<version>`, kept in step with
  `tetanus-collect` by the same test. It stays excluded from `Host.collectorVersion`:
  the zedlet is installed by the same `install.sh`, so it moves with the collector.
- This is a collector change: bump to 0.3.1. `MIN_COLLECTOR_VERSION` stays 0.3.0.

## Tests

- `shared/collector.test.ts`: status table (null, garbage, below min, between, equal,
  newer); producer parsing; version-in-script assertions.
- `server/services/ingest.test.ts`: producer sets `collectorVersion`; `tetanus-zed/...`
  and null leave it alone.
- Migration backfill against a seeded `CollectorRun`.
- Status transitions: version bump to incompatible, recovery, raised minimum with an
  unchanged version, `unknown → current` recording nothing.
- `rules.test.ts`: both new rules, and no alert for `current → outdated`.
- `useFaults.test.ts`: incompatible yields the fault; outdated and unknown do not.
- Hosts page: badge per status; upgrade command shown only for outdated and incompatible.

## Out of scope

- **Self-update.** The collector runs as root, so auto-updating from the server would give
  anyone who compromises the server root on every host. It would also break the
  "dumb collector" boundary, where the server receives data but never runs code on hosts.
  If it is ever wanted: opt-in `TETANUS_AUTO_UPDATE=1` in `collect.env`, a separate
  `tetanus-update.timer` (the collector unit's `ProtectSystem=strict` cannot replace
  `/usr/local/bin`), and CI-signed releases (minisign) verified against a key pinned at
  install time. Signing on the server adds nothing.
- Advertising the latest version in the ingest response so the collector logs it.
