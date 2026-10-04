---
type: task
status: todo
---

# Getting started

First-run experience from an empty database to a configured install. Today the home
page shows "No hosts have reported yet" with the install command and a link to
`/hosts/add` ([054](054-Hosts-page.md)). Once the first host posts, the empty state
disappears and the user is in a populated app with no steer. Written up 2026-10-04
after a first-run review.

## Problems

1. **Server URL.** `InstallCommand` takes `useRequestURL().origin`. Opened at
   `http://localhost:3000` the command tells the NAS to curl localhost. Behind a
   reverse proxy without forwarded headers, or reached by IP on one occasion and
   hostname on another, the URL baked into `/etc/tetanus/collect.env` is whatever the
   browser happened to use. The collector uses it on every run, not just at install.
2. **No next steps.** After the first host reports there is nothing pointing at: set
   aliases (or that they come from `vdev_id.conf`); fill inventory; configure alerts
   and the healthchecks URL; import from scrutiny; add the next host.
3. **Nothing says what to expect.** The empty state does not say the host appears
   within a minute (install collects straight away) or that SMART history starts from
   the first hourly run.
4. **Requirements hidden.** OpenZFS 2.3+ / smartmontools 7.4+ / systemd are only on
   the add page. A failed install on Debian 12 is avoidable with one line.
5. **Partial first state.** A host whose first post is rejected (old ZFS JSON, wrong
   smartctl) or that has posted `versions` but nothing else: confirm what the home
   page and hosts list show. [035](035-Collector-version-tracking.md) raises
   `collector-incompatible`; the zero-pools, zero-disks tile needs checking.
6. Enrol token is shown in plaintext on the home page; fine for a single-user
   no-auth app, must be hidden in the demo (the add page already is).

## Plan

### Server URL setting

- `Settings.config.serverUrl?: string` (http/https URL, no trailing slash). Empty
  means "use the request origin".
- `InstallCommand` and the upgrade command on `/hosts` read a shared
  `useServerUrl()` composable: setting if set, else origin.
- Warn inline when the effective URL is loopback (`localhost`, `127.`, `[::1]`) or
  when the origin differs from the saved setting: "Hosts will connect to this URL;
  set it in Settings if they cannot reach it." Link to Settings › General.
- Settings › General: "Server URL" field with the current origin as placeholder.

### Getting started panel

A checklist on the home page above the topology, shown until every item is done or
it is dismissed. Items are computed from data, not stored, except the dismissal
(`Settings.config.gettingStartedDismissedAt`).

| item | done when | links |
| --- | --- | --- |
| Add a host | `hosts.length > 0` | `/hosts/add` |
| Name your disks | every in-use/spare disk has an alias | `/disks`; note that `vdev_id.conf` aliases are picked up automatically |
| Record what you bought | every in-use/spare disk has at least one inventory field set | `/disks` |
| Get told when something breaks | a notification channel is configured | `/settings/alerts` |
| Know when a host goes quiet | every host has a healthchecks URL, or the item is skipped by hand | `/hosts/:id` |
| Bring history from scrutiny | an import has run, or skipped | `/settings/import` |

- Skip per item (stored as a list in the same setting) for the optional ones:
  healthchecks and scrutiny.
- Panel disappears when all items are done or skipped, or on "Dismiss". Reachable
  again from Settings › General ("Show getting started").
- Demo: panel hidden.

### Empty state copy

- Add the requirements line and "The host appears here within a minute of
  installing; SMART history starts on the first hourly run."
- Home page polls `/api/hosts` every 10 s while empty, like the add page, so the
  empty state swaps to the topology without a reload.

### Partial-state check

- Seed a host with only a `versions` run and with an incompatible version; confirm
  the home tile, hosts list and faults page say something useful. Fix what doesn't.

### Code

- `shared/schemas/settings.ts`: `serverUrl`, `gettingStarted` config.
- `app/composables/useServerUrl.ts`, test.
- `app/components/GettingStarted.vue` + `gettingStarted.ts` (pure item computation,
  tested against disk/host/settings shapes).
- `app/pages/index.vue`: panel, polling, copy. `app/pages/settings/index.vue`:
  server URL field, show-again button.
- `InstallCommand.vue`: loopback warning.

## Unanswered questions

1. Does the server URL setting also drive anything server-side (alert links, webhook payload URLs)? If so it belongs in Settings regardless and the install command is just one consumer.
2. "Name your disks": is an alias expected for every disk, or only pool members? Spare and non-ZFS disks (028) may never get one.
3. Should the panel live on the home page or on `/hosts` once a host exists?
