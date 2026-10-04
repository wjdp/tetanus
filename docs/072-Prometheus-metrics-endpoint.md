---
type: task
status: planned
---

# Prometheus metrics endpoint

Stub. tetanus's state can't be read by an existing metrics stack.

## Problem

People with a metrics stack want disk and pool state in their own dashboards and
alerting. Prometheus support was the third most-requested scrutiny feature
(AnalogJ#74, 33 reactions; also AnalogJ#11, pull data into existing tools), and
Starosdev ships `/api/metrics`. tetanus has no machine-readable read API beyond its
internal routes.

## Context

- The author runs Telegraf and InfluxDB. Telegraf's `inputs.prometheus` scrapes the
  Prometheus text format, so one endpoint serves both stacks.
- Telegraf also has native `inputs.smart` and `inputs.zfs` plugins. Raw metrics are
  already available that way. What only tetanus has is the evaluated layer: verdicts,
  open faults, lifecycle state, aliases as labels.
- No UI auth ([001](001-Product-goals.md)); the endpoint would be as exposed as the
  rest of the app.
- Label cardinality: alias, host and pool labels change when a disk moves.

## Questions

1. Raw readings as well, or only evaluated state (status, fault counts, lifecycle)?
