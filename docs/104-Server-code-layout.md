---
type: task
status: todo
---

# Server code layout

## Problem

`AGENTS.md` describes `server/services/` as "domain logic over the DB". That no longer matches the code, and the layout around it has drifted:

- `services/` holds about 90 non-test files, mostly flat, of several kinds: database-backed domain modules, pure logic with no database or network imports (`identity.ts`, `usage.ts`, `alerts/rules.ts`, `replications/derive.ts`), outbound HTTP (`alerts/channels.ts`, `healthchecks.ts`, `importers/scrutinyApi.ts`), one-off backfills and the fault simulator. 16 of the files never import the database.
- Ingest is split across three places. `api/ingest/[source].post.ts` does auth and body limits, `services/ingest.ts` is the pipeline (`recordIngest`), and `server/ingest/` holds the parsers, `registry.ts` and `handlers.ts`. The directory named `ingest` is not the ingest feature.
- `ingest/handlers.ts` imports six services, and `services/zfs.ts` imports the `IngestHandler` type back from it. The cycle is type-only, but the dependency direction is unclear.
- Related modules are scattered at the top of `services/`:
  - Faults: `faults.ts`, `liveFaults.ts`, `farmFaults.ts`, `poolFaults.ts`, `temperatureFaults.ts`, `faultsBackfill.ts`.
  - Disks: `disks.ts`, `identity.ts`, `hardware.ts`, `usage.ts`, `bridge.ts`, `locations.ts`, `bays.ts`, `statistics.ts`, `drive-db/`.
- `zfs.ts` + `zfs/` and `replications.ts` + `replications/` are a file and a directory of the same name side by side.
- `server/tasks/` mixes queue infrastructure (`queue.ts`, `router.ts`), queue jobs (`queueable/`) and Nitro tasks (`handler.ts`, `alerts/tick.ts`, `healthchecks/ping.ts`, `retention/prune.ts`).
- Nitro registers every file under `server/tasks/` as a task named after its path, so the build carries `queueable:alertsTick`, `queueable:noop` and the rest as Nitro tasks that are never meant to be run that way. Only `handler`, `alerts:tick`, `healthchecks:ping` and `retention:prune` are real ones.
- `services/ingest.ts` imports `tasks/queueable/alertsTick`, so a service depends on the task layer.
- Synthetic data generation lives in two places: `server/demo/` and `services/simulator/`.

## Context

- Nitro fixes the meaning of `api/`, `routes/`, `middleware/`, `plugins/`, `tasks/` and `utils/`. Everything else under `server/` is free to move.
- Nitro's `scanTasks` takes every file under `tasks/` and derives the task name from the path (`/` becomes `:`). `tasks/handler.ts` is a `defineTask` that drains the queue; `queue.ts` and `handler.ts` start it with `runTask("handler")`, so it has to stay a Nitro task.
- Services import parser result types 31 times. That direction is fine: parsers are a leaf with no imports from `services/` or `database/`, apart from `handlers.ts`.
- There are 111 imports between service modules, all by absolute `~~/server/services/...` path, so regrouping `services/` is a mechanical but wide rewrite.
- Tests are co-located and move with their modules. `test/` helpers and `vitest` project globs may name paths under `server/`.
- Docs reference code paths; `wj links` / `wj backlinks` find them.
- [003](003-Architecture-and-data-model.md) calls the path from collector to database "the ingest seam".
- Biome `noRestrictedImports` already enforces that `app/` and `shared/` do not import from `server/`.

## Plan

Target layout:

```
server/
  ingest/
    pipeline.ts     recordIngest, from services/ingest.ts
    handlers.ts     parser output -> services
    types.ts        IngestContext, IngestHandler
    parsers/        current ingest/*.ts, including registry.ts
  services/
    disks/          disks, identity, hardware, usage, bridge, locations, bays, statistics, drive-db
    smart/          smart, smartPolicy, acceptance
    faults/         faults, live, farm, pool, temperature, backfill
    zfs/  replications/  alerts/  importers/
    hosts.ts  diary.ts  settings.ts  navigation.ts  retention.ts  ...
  queue/            queue.ts, router.ts, jobs/ (was tasks/queueable/)
  tasks/            Nitro tasks only: handler and the scheduled ticks
  synthetic/        demo/ and simulator/
```

Dependency rule: `ingest/parsers` imports nothing from `server/`; `services` may import `ingest/parsers` (types), `ingest/types`, `database`, `queue` and `utils`; `ingest/pipeline` and `ingest/handlers` may import `services`; `api`, `routes`, `tasks` and `plugins` may import anything.

Steps, each a separate commit with no behaviour change:

1. **Ingest.**
   - Move `server/ingest/*.ts` parsers and `registry.ts` to `server/ingest/parsers/`.
   - Move `services/ingest.ts` to `server/ingest/pipeline.ts`.
   - Move `IngestContext` and `IngestHandler` from `handlers.ts` to `server/ingest/types.ts`; `services/zfs.ts` imports the type from there.
2. **Queue.**
   - Move `tasks/queue.ts` and `router.ts` to `server/queue/` and `tasks/queueable/` to `server/queue/jobs/`.
   - `tasks/` keeps only the `defineTask` files: `handler.ts` and the three scheduled ticks. Task names do not change.
   - `enqueueUnlessPending` and `requestAlertsTick` move out of the `alertsTick` job into `queue/`, so `ingest/pipeline.ts` no longer imports a job.
3. **Service grouping.**
   - Create `services/disks/`, `services/smart/` and `services/faults/` and move the modules listed above. Drop the `Faults` suffix inside `faults/` (`faults/pool.ts`, `faults/farm.ts`, `faults/temperature.ts`, `faults/live.ts`, `faults/backfill.ts`).
   - Move `ataSsdAttributesBackfill.ts` beside the module it backfills.
   - Replace `services/zfs.ts` and `services/replications.ts` with `index.ts` inside their directories, or rename them to say what they hold.
4. **Synthetic data.** Move `server/demo/` and `services/simulator/` under `server/synthetic/`.
5. **Enforce and document.**
   - Add Biome `noRestrictedImports` overrides for the dependency rule, at least: parsers import nothing from `services/` or `database/`; `services/` does not import `ingest/pipeline`, `ingest/handlers`, `tasks/` or `api/`.
   - Update `AGENTS.md`: `services/` is application and domain logic called by routes, tasks and ingest handlers; it throws `ServiceError` and does not depend on h3. Update the directory list.
   - Update code paths in `docs/`.

## Verification

- `pnpm typecheck`, `pnpm lint:ci` and `pnpm test` pass after each step.
- `rg "~~/server/ingest/handlers" server/services` returns nothing.
- `rg "~~/server/(services|database)" server/ingest/parsers` returns nothing.
- After `pnpm build`, the task registry in `.output/server` lists only `handler`, `alerts:tick`, `healthchecks:ping` and `retention:prune`.
- Queue a `noop` task through `POST /api/tasks` and see it complete.

## Decisions

- `recordIngest` moves to top-level `server/ingest/pipeline.ts`.
- Demo and simulator both move under `server/synthetic/`.
- The `services/` regrouping goes ahead now; open branches rebase over it.
