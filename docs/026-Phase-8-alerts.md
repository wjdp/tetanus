---
type: task
status: done
---

# Phase 8 alerts

Phase 8 of the [project plan](004-Project-plan.md): alert rules after ingest,
notification channels, healthchecks pings per host. Design in
[003](003-Architecture-and-data-model.md) §Services (alerts).

## Contract

### Rules

Alerts derive from diary auto events, which already record every transition the rules
in 004 name. An alerts pass reads diary entries newer than a stored cursor
(`Setting.config.alertCursor`, the last diary id processed) and maps them:

| eventType | condition | rule | severity |
| --- | --- | --- | --- |
| `attribute-status-changed` | `to === "failed"` and no active acceptance | `attribute-failed` | alert |
| `acceptance-superseded` | | `acceptance-superseded` | alert |
| `smart-status-changed` | `to === "failed"` | `disk-failed` | alert |
| `smart-status-changed` | `from === "failed"` and `to !== "failed"` | `disk-recovered` | recovery |
| `state-changed` | `to === "missing"` | `disk-missing` | alert |
| `state-changed` | `from === "missing"` and `to` in `in-use`/`spare` | `disk-reappeared` | recovery |
| `pool-state-changed` | `to !== "ONLINE"` | `pool-degraded` | alert |
| `pool-state-changed` | `to === "ONLINE"` | `pool-recovered` | recovery |
| `scrub-finished` / `resilver-finished` | `errors > 0` | `scan-errors` | alert |
| `identity-conflict` | | `identity-conflict` | alert |

Dedupe key `${rule}:${subjectType}:${subjectId}:${value}` where `value` is the
distinguishing datum (attrId, state, errors count); a key already in `Notification`
with `ok=true` is not sent again. Recovery rules clear nothing; they are just sent.

Subject text carries the host: "mars · K2: Current Pending Sector Count failed (16)".
Disk subjects use alias, else model + serial; pool subjects `host · pool`.

### Trigger

`alerts:tick` task: materialise disk state transitions by calling `listDisks()`, run
the pass, dispatch. Enqueued after every successful ingest (`recordIngest`, outside the
transaction, only when the queue has no pending tick) and by a Nitro scheduled task
every 5 minutes. `healthchecks:ping` scheduled every 5 minutes.

### Channels

`Setting.config.notifications`: `{ pushover: { token, user } | null, webhook: { url,
secret? } | null }` (zod in `shared/schemas/settings.ts`; secrets returned by
`GET /api/settings` are masked as `"•••"` and a PATCH with the mask keeps the stored
value; later removed: secrets come back in clear, like the enrol token, and each
channel card saves on its own, with "Send test" saving first). Pushover: `https://api.pushover.net/1/messages.json`, priority 0 for recovery,
1 for alert, title = rule label, message = subject text. Webhook: `POST` JSON
`{ rule, severity, subject, subjectType, subjectId, host, title, message, at, dedupeKey
}`, header `Tetanus-Signature: sha256=<hmac>` (derived from the app name, no `X-`) when `secret` is set. 10 s timeout.

`Notification` table: id, at, channel, rule, dedupeKey, subject, title, message, ok,
error nullable, diaryEntryId nullable; index(dedupeKey), index(at). A failed send is
retried on the next tick (its key is not counted as sent).

Routes: `GET /api/alerts?limit=` (notifications newest first),
`POST /api/alerts/test` `{ channel: "pushover" | "webhook" }` sends a test message and
returns `{ ok, error }`.

### Healthchecks

`shared/hostFreshness.ts` takes over `app/utils/hostFreshness.ts` (the app file
re-exports). `pingHealthchecks()` for every host with `healthchecksUrl`: if every cadence
group is `ok` → `GET <url>`; if any group is `warning`/`error` → `GET <url>/fail` with a
plain-text body naming the stale groups. 10 s timeout, errors logged only.

### UI

Settings › Alerts (`/settings/alerts`, added to `SETTINGS_NAVIGATION`): Pushover
token/user, webhook URL/secret, Save, "Send test" per channel with the result inline;
recent notifications table (at, channel, rule, subject, ok/error).

## Findings

- `app/utils/hostFreshness.ts` re-exports via a relative path (`../../shared/hostFreshness`), not `#shared/hostFreshness`: unimport can't resolve the `#shared` alias when scanning `app/utils` for auto-imports, so the alias silently failed to register `allGroupFreshness` etc. as globals.
- `pingHealthchecks` iterates `listHosts()` sequentially (not `Promise.all`) so one slow/erroring host can't race another's timeout handling; fine at expected host counts.

### Alerts core

Shapes for the UI:

- `GET /api/settings` → `config.notifications`: `{ pushover: { token: "•••", user: "•••" } | null, webhook: { url, secret?: "•••" } | null }`; `secret` is absent when none is stored. `config.alertCursor` (number) is also returned; PATCH rejects it.
- `PATCH /api/settings` `{ config: { notifications: { pushover?, webhook? } } }`: each channel is optional (omitted = unchanged), `null` disables it, an object replaces it. Send `"•••"` back for any secret to keep the stored value (400 if nothing is stored). An empty webhook `secret` means none. Webhook URL must be http(s). Response is masked.
- `GET /api/alerts?limit=` (1–500, default 50), newest first: `{ id, at, channel: "pushover" | "webhook", rule, dedupeKey, subject, title, message, ok, error: string | null, diaryEntryId: number | null }`. `subject` is `mars · K2`; `message` is the full line `mars · K2: Current Pending Sector Count failed (16)`; `title` is the rule label.
- `POST /api/alerts/test` `{ channel }` → `{ ok: true, error: null } | { ok: false, error }` (200 for send failures and for an unconfigured channel, 400 only for a bad body). Test sends are not recorded in `Notification`.
- Labels: `ALERT_RULES[rule].label`, `ALERT_CHANNEL_LABELS` in `shared/alerts.ts`; `SECRET_MASK` in `shared/schemas/settings.ts`.

Decisions:

- Dedupe key appends the diary entry id: `${rule}:${subjectType}:${subjectId}:${value}:${entryId}`. The contract key without it would alert once ever per disk/pool state, so a pool degrading a second time, or a disk going missing again, would be silent. Emitters already record transitions only and the cursor stops rereads, so the key now guards retries and reruns. Drop the last segment to restore the contract behaviour.
- Migration `0004_notification` also sets `alertCursor` to the current max diary id on existing installs, so the first pass does not replay the whole diary history as alerts.
- The cursor advances before sending. Failed sends are retried at the start of later passes for 24 h (by `Notification.at`), re-deriving from the diary entry: a retry updates the same row (`ok`, `error`), and is dropped if the alert no longer derives (fault since accepted, channel removed). A crash mid-pass loses that pass's unsent alerts.
- `attribute-failed` checks acceptances at pass time, not at event time, so accepting within the tick window also suppresses the alert.
- Scheduled Nitro tasks (`server/tasks/alerts/tick.ts`, `server/tasks/healthchecks/ping.ts`, cron `*/5 * * * *`) only enqueue the queue task of the same name, so every pass is serialised through the queue. `enqueueUnlessPending` lives in `server/tasks/queueable/alertsTick.ts` (uses `getAllTasks`) and skips only when a *pending* task exists: an in-progress tick may already have read the cursor, so a new one is still queued.
- `recordIngest` stays synchronous and fires `requestAlertsTick()` without awaiting; queue errors are logged. Unit tests that call `recordIngest` without stubbing `useStorage` log a swallowed error.
- Pushover priority: 1 alert, 0 recovery and test; `timestamp` is the diary entry time. Webhook test payload has `rule: "test"`, `severity: "test"`, null subject fields.
- Queue storage is never pruned: with a tick per ingest (when none pending) plus two scheduled tasks every 5 minutes, task records grow unbounded in Nitro storage. Worth pruning done tasks in `queue.ts`.

### UI and queue follow-ups

- Settings › Alerts: channel cards (`app/components/alerts/ChannelCard.vue`) own their "Send test"; tests use the *saved* settings, so the card says so. Secret inputs are `type="password"` and select the mask on focus so typing replaces it. Form ↔ PATCH mapping is pure in `app/components/alerts/channelForms.ts`; a PATCH 400 (e.g. enabling Pushover with blank fields) surfaces its message in the error toast.
- Diary subject picker also covers `vdev` (not in the brief): vdevs flattened from `/api/pools` trees, labelled `host · pool · vdev`, root excluded. Pool labels use `host.name` (matching alert subjects), not `displayName`. Items load per subject type via `useLazyAsyncData` with a reactive key, client-only; changing the type clears the chosen subject. Mapping lives in `app/utils/diarySubjects.ts`.
- Queue: `completeTask` prunes finished (`done`/`failed`) task records beyond the newest `FINISHED_TASKS_KEPT` (200); pending and in-progress are never touched. It reads every task record per completion, fine at this size.
- `requestAlertsTick` swallows only a `ReferenceError` naming `useStorage` (unit tests without Nitro's auto-import); other queue failures are still logged. `recordIngest` is unchanged.
