---
type: task
status: planned
---

# Home Assistant integration

Idea. Disk and pool state in Home Assistant.

## Problem

The author runs Home Assistant with MQTT. tetanus's state (disk health, temperature,
pool health, open faults) isn't visible there, so it can't drive HA dashboards,
automations or notifications alongside the rest of the house. Starosdev's scrutiny
publishes MQTT discovery entities per drive: temperature, health, power-on hours,
power cycles, and a problem binary sensor.

## Context

- MQTT discovery needs tetanus to connect to a broker: an outbound dependency and
  config the app doesn't have today.
- Alternatives that avoid a broker: an HA REST sensor or custom integration polling a
  tetanus endpoint (overlaps [072](072-Prometheus-metrics-endpoint.md)), or the
  existing webhook alert channel posting to an HA webhook trigger.
- Entity naming: aliases are the disk's name everywhere, but they change.
