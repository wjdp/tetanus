---
type: task
status: todo
---

# Faults page

A top-level "Faults" view of everything wrong right now, with a count badge on its nav
entry. Grew out of the fault banners
([035](035-Collector-version-tracking.md) §Fault, [004](004-Project-plan.md) Phase 8
step 4): the strip at the top of every page shows only collector faults, dismissals
live in one browser's `localStorage`, and a dismissed fault is gone with no way to
see it again.

## Is it worth it?

Yes, but only as a **current-problems** page, not an index of banners. Two collector
fault types do not justify a nav entry. What the app lacks is one place answering
"what needs my attention": disk and pool state is spread over Topology, Disks and
each disk's SMART tab, alert history is under Settings and is a log of sends, not of
state. A Faults page is that view. The banners become the urgent subset of it.

Alternative considered: fold this into the Topology page as a summary block. Rejected:
Topology is per-host and already dense, and a badge in the nav is the thing that makes
the count visible from anywhere.

## Contract

### Fault model

A fault is a **condition that holds now**, derived on request, not stored. Distinct
from alerts (events, sent once, in `Notification`) and from diary entries (history).
`shared/faults.ts`:

```ts
interface Fault {
  id: string;            // stable while the condition holds; see per-kind ids
  kind: FaultKind;
  severity: "error" | "warning";
  host: string;
  subject: { type: "host" | "disk" | "pool"; id: number; label: string } | null;
  title: string;         // one sentence, no host prefix (the row shows the host)
  detail?: string;       // one more sentence when the title is not enough
  command?: string;      // a fix to copy, when there is one
  to?: string;           // route to the subject
  since: string | null;  // ISO, when the condition started, if known
  dismissed: boolean;
}
```

Kinds, all derivable from existing services with no schema change beyond
dismissals:

| kind | source | severity | id |
| --- | --- | --- | --- |
| `collector-silent` | `allGroupFreshness` all non-ok (as today) | error | `collector-silent:<host>` |
| `collector-incompatible` | `collectorStatus(version) === "incompatible"` | error | `collector-incompatible:<host>:<version>` |
| `collector-outdated` | `collectorStatus(version) === "outdated"` | warning | `collector-outdated:<host>:<version>` |
| `disk-failed` | device status `failed` | error | `disk-failed:<diskId>` |
| `disk-warning` | device status `warning` with no active acceptance covering it | warning | `disk-warning:<diskId>` |
| `disk-missing` | `lastState === "missing"` | error | `disk-missing:<diskId>` |
| `pool-degraded` | pool state not `ONLINE` | error | `pool-degraded:<poolId>:<state>` |
| `scan-errors` | last scrub/resilver `errors > 0` | error | `scan-errors:<poolId>:<scanId>` |
| `identity-conflict` | unresolved identity conflict | error | `identity-conflict:<diskId>` |

Ids carry the distinguishing datum so a dismissal expires when the condition changes
(same rule as the collector ids today). `since` comes from the diary entry that
opened the condition where one exists (`state-changed`, `smart-status-changed`,
`pool-state-changed`), else null.

### Derivation moves server-side

`server/services/faults.ts`: `listFaults(now): Fault[]` composing `listHosts`,
`listDisks`, `listPools` and `activeAcceptances`. `GET /api/faults` returns
`{ faults, counts: { error, warning, dismissed } }`. `useFaults()` becomes a thin
`useFetch("/api/faults")` polled on the same 30 s cadence as the hosts page and
refreshed on the SSE `ingest` event, so the badge moves when data arrives. The pure
collector rules and their tests move from `app/composables/useFaults.ts` to the
service; the demo cadences go with them (`DEMO_CADENCES` is already in `shared/`).

### Dismissals

Server-side, so they hold across browsers and survive a cleared cache.
`Setting.config.dismissedFaults: string[]` (zod in `shared/schemas/settings.ts`),
routes `POST /api/faults/:id/dismiss` and `DELETE /api/faults/:id/dismiss`. The
service prunes ids that no longer derive on every `listFaults` call so the list does
not grow. A dismissal is a diary auto entry (`fault-dismissed`, subject from the
fault) so the diary shows who-did-what; restoring is `fault-restored`. Migration:
none; existing `localStorage` dismissals are simply forgotten.

Dismissing is not accepting: an accepted SMART attribute (Phase 7) changes the
evaluation and the fault disappears; a dismissed fault still counts as a fault, it
just stops shouting. The page makes this distinction visible.

### Page

`/faults`, nav entry after Topology: `{ label: "Faults", icon: "i-lucide-siren" }`.
Badge = count of undismissed errors; `UNavigationMenu` items take `badge`, so
`NAVIGATION` entries gain an optional `badge` resolver or the sidebar merges the count
in. Colour `error` when any undismissed error, `neutral` for warnings only, no badge
at zero. Command palette gets the same entry.

Layout, same log-row treatment as the banner strip (`AppFaultBanners.vue`), one
section per severity, dismissed rows last and dimmed:

```
Faults                                        3 errors · 1 warning · 2 dismissed

┃ mars    Collector 0.2.0 is too old; 0.3.0 or later is needed   since 2 d   [curl … | sudo bash ⧉]   Dismiss
┃ mars    K2 failed: Current Pending Sector Count 16             since 4 h   → disk                  Dismiss
┃ pihost   Pool tank is DEGRADED                                  since 1 h   → pool                  Dismiss
│ mars    Collector 0.3.0 is behind 0.3.1                        since 6 d   [curl … | sudo bash ⧉]   Dismiss
  pihost   No data for 3 d   (dismissed)                                                               Restore
```

Red gutter for errors, amber for warnings, none when dismissed. Empty state: "Nothing
needs attention" with the time of the last ingest. Row action goes to the subject
(disk page, pool card on Topology) where the real remedy lives (accept, alias, replace).

### Banner strip

Shows undismissed **error** faults only, capped at three with "and 2 more → Faults"
as a fourth row. Warnings live only on the page. Dismiss on the strip is the same
server-side dismissal.

### Alerts

`alerts:tick` and the faults service must agree: every `alert`-severity rule in
`ALERT_RULES` that describes a state (not a one-off like `scan-errors` recovery)
should have a fault kind, and vice versa. Add a test that maps the two tables so a
new rule without a fault kind (or the reverse) fails. Do not derive faults from
`Notification`: sends fail, retries lapse after 24 h, and a fault must not depend on a
channel being configured.

### Tests

- `server/services/faults.test.ts`: one case per kind, plus dismissal pruning and
  the acceptance overlay on `disk-warning`.
- `test/api/faults.e2e.test.ts`: list, dismiss, restore, counts.
- `useFaults.test.ts` shrinks to fetch-and-refresh behaviour.
- `AppFaultBanners.test.ts`: cap and overflow row.
- Nav badge: renders count, hidden at zero.

## Out of scope

- Per-fault snooze until a date. Dismiss is permanent for that id; the id changes
  when the condition does.
- Sending a notification on dismissal.
- Fault kinds needing new ingest (replication lag [015](015-Replication-health.md),
  snapshot staleness [016](016-Snapshot-staleness.md), scrub overdue
  [017](017-Scrub-and-self-test-overdue.md)). Each of those tasks adds its kind to
  `listFaults` when it lands; this task leaves the seam.

## Open questions

- Warning threshold for `collector-outdated`: fault at every patch release is noise on
  a fleet that updates monthly. Option: only when behind by a minor version, or only
  after N days behind. Default proposed: any version behind, warning severity, no badge
  contribution.
- Should `disk-warning` (SMART warning without acceptance) be a fault at all, or is the
  Disks page status column enough? Proposed: yes, warning severity, because it is the
  main thing a home user is supposed to act on (accept or watch).
- Badge counts errors only, or errors + warnings? Proposed: errors only.
