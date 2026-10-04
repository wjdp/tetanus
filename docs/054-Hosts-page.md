---
type: task
status: todo
---

# Hosts page

Move hosts out of Settings into their own section with list, detail and add pages.
Today `/settings/hosts` holds the table, a slideover editor, the upgrade command and the
install command; faults, diary entries and disk pages for a host all link to that one
page.

## Why

- Hosts are a first-class subject (faults, diary, simulator) with no page of their own.
- Adding a host is the first thing a new install needs and is buried at the bottom of a
  settings tab.
- The slideover editor is the only place host config lives; editing several hosts in
  one go is rare, so a detail page is a better home.

## Routes

- `/hosts`: list. Current table (drag reorder, collector badges, tool versions,
  freshness, last seen, simulate menu) and the upgrade-collector section. Row click
  navigates to `/hosts/:id`. "Add host" button in the header; the empty state links
  there too.
- `/hosts/:id`: detail.
- `/hosts/add`: install instructions.
- `/settings/hosts`: `routeRules` redirect to `/hosts`; delete the page.
- Sidebar: "Hosts" (`i-lucide-server`) in `NAVIGATION` before Disks; remove it from
  `SETTINGS_NAVIGATION`. Command palette gets an "Add host" action and host entries
  linking to `/hosts/:id`.

## Detail page

Shape follows `pages/replications/[id].vue`. `GET /api/hosts/:id` exists.

- Header: display name (name beneath when set), intermittent badge,
  `HostFreshnessChips`, simulate menu.
- Fault summary: counts of open faults on the host and on its disks and pools, by
  severity, each linking to the subject page. Host-level faults (silent collector,
  outdated collector) listed in full; disk and pool faults stay on their own pages.
- Disks and pools on the host: compact lists linking to `/disks/:id` and `/zfs/:id`.
  Filter `/api/disks` and `/api/pools` client side; add a `hostId` query only if the
  payloads prove too large.
- Collector: version and badge, every tool version (the list shows only zfs and
  smartctl), upgrade command when outdated or incompatible.
- Settings: the slideover's fields inline (display name, intermittent, healthchecks
  URL, notes, temperature thresholds), saved with the existing `PATCH`. Drop the
  slideover.
- Diary: `DiaryTimeline` and `DiaryEntryForm` over
  `/api/diary?subjectType=host&subjectId=:id`.

## Add host page

- Requirements: bash, curl, OpenZFS 2.3+, smartmontools 7.4+.
- `InstallCommand` with the server origin and enrol token.
- `--host <name>` override, `--no-collect`, idempotent re-run.
- What gets installed and the timer schedule, condensed from `host/README.md`.
- How to check it: the README's "Check it" steps.
- Watch `/api/hosts` and show "<name> reported" once a new host appears.
- Demo: replace the commands with a note that installs are disabled.

The enrol token itself stays in Settings → General; this page only uses it.

## Links to repoint

From `/settings/hosts` to `/hosts/:id` (or `/hosts` where there is no single host):

- `app/utils/vocabulary/fault.ts` `faultSubjectPath`
- `app/components/diary/DiaryTimeline.vue` `subjectLink`
- `app/components/disk/DiskNameplate.vue`
- `app/pages/index.vue`, `app/pages/disks/index.vue` (`/hosts`)
- `app/components/topology/HostSection.vue`: host title becomes a link

Matching tests: `fault.test.ts`, `navigation.test.ts`, `faults.test.ts`,
`disks/index.test.ts`, `DiaryTimeline.test.ts`.

## Code

- `app/components/host/`: `HostTable`, `HostSettingsForm`, `HostCollectorPanel`,
  `HostFaultSummary`; tool-version and collector-badge helpers move to a tested `.ts`.
- Pages: `app/pages/hosts/index.vue`, `[id].vue`, `add.vue`, each with a test; carry
  over the cases from `settings/hosts.test.ts`.
- `host/README.md`: point "settings page" references at the hosts pages.
