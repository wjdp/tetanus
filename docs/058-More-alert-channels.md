---
type: task
status: planned
---

# More alert channels

Stub. Alerts go to Pushover or a generic JSON webhook. That is the author's setup and
not much else.

## Problem

Self-hosters expect the usual set: ntfy, Gotify, Discord, Telegram, Slack, Matrix,
Apprise, email. The generic webhook can reach some of them with a relay in between,
but each wants its own payload shape and the user has to write the glue. Email is the
one that will be asked for first and the one that needs the most config (SMTP host,
auth, TLS, from, to).

## Context

- Channels: `shared/alerts.ts` (`ALERT_CHANNELS`, labels), config schemas in
  `shared/schemas/settings.ts` (`pushoverConfigSchema`, `webhookConfigSchema`),
  senders in `server/services/alerts/channels.ts`, dispatch and the test button in
  `dispatch.ts`. `Notification` records every send with `ok` / `error`.
- Severities are `alert`, `notice`, `recovery`; Pushover maps them to priority. Each
  channel would need its own mapping.
- Settings › Alerts has a form per channel with a test button.
- No per-rule routing: every channel gets every rule. Users with several channels
  usually want "recoveries to ntfy, failures to everything".
- Apprise would cover every service in one integration but means running a second
  container, which [001](001-Product-goals.md) rules out as a dependency; as an
  optional target it may still be the pragmatic answer.

## Questions

1. Which channels first? ntfy and Discord are thin over the webhook sender; email needs an SMTP library.
2. Per-rule or per-severity routing in scope, or still "every channel gets everything"?
3. Is Apprise-as-optional-target acceptable, or does every channel have to be native?
