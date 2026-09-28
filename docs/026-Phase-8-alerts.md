---
type: task
status: todo
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
value). Pushover: `https://api.pushover.net/1/messages.json`, priority 0 for recovery,
1 for alert, title = rule label, message = subject text. Webhook: `POST` JSON
`{ rule, severity, subject, subjectType, subjectId, host, title, message, at, dedupeKey
}`, header `X-Tetanus-Signature: sha256=<hmac>` when `secret` is set. 10 s timeout.

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
