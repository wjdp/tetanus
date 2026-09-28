---
type: task
status: done
---

# Phase 1 scaffold

Phase 1 of the [project plan](004-Project-plan.md): the empty app, cloned from grate's
shape and conventions, with nothing disk-specific in it yet.

## Scope

1. Nuxt 4 + Nuxt UI 4 + Tailwind 4 scaffold, Biome, lefthook, two-project Vitest.
2. Drizzle on better-sqlite3: client, column helpers, migrator (Nitro plugin in
   production, `pnpm db:migrate` in dev), first migration with the `Setting` table.
3. Task queue, SSE, sidebar task indicator, one no-op task.
4. Settings service: single row, enrol token (32 random bytes, hex) generated on first
   boot, `GET`/`PATCH /api/settings`, `GET /health`.
5. Dockerfile, `run.sh`, `compose.yml`, GitHub workflows (checks, main → `edge`,
   release) pushing `ghcr.io/wjdp/tetanus`.
6. `AGENTS.md`, `CLAUDE.md` symlink, README.
7. Layout: sidebar (Topology, Disks, ZFS, Diary, Settings), Cmd/Ctrl+K command palette
   over the same five pages, fault banner slot fed by `useFaults()` (empty), settings
   page showing the enrol token with a copy button.

## Findings

Deviations from grate:

- **`@nuxt/test-utils` pinned to 4.2.0.** 4.3 calls `vi.resetModules()` in its setup
  entry, so `test/setup.ts` migrated one `:memory:` database and the tests imported
  another ("no such table"). grate is on 4.2.0 and unaffected. Revisit when upgrading.
- **pnpm 10**, so `pnpm-workspace.yaml` uses `onlyBuiltDependencies` /
  `ignoredBuiltDependencies` rather than grate's pnpm 11 `allowBuilds`. The Dockerfile
  installs `pnpm@10.34.3`.
- **zod 4** rather than grate's zod 3.
- **Biome excludes `docs/`, `bin/` and `test/fixtures/`.** grate's config formats every
  file git doesn't ignore; the first `pnpm lint` here reformatted the captured JSON
  fixtures, which must stay byte-for-byte as captured.
- **Column helpers** live in `server/database/columns.ts`, exported, instead of
  private consts at the top of `schema.ts`, so later schema files can share them.
- **`Setting` is enforced single-row** with `CHECK (id = 1)`; grate's `User` relies on
  the service only ever inserting one.
- **`server/sse.ts`** unhooks each connection's listener when its stream closes (grate
  leaks one hook per connection) and drops the per-message `console.log`s.
- **Task payload** is a flat `Record<string, string | number | boolean>` instead of
  grate's provider-shaped object. Task names are just `noop` for now.
- **Queue tests are new.** grate has none; `server/tasks/queue.test.ts` stubs Nitro's
  `useStorage` and `runTask` globals with an in-memory store.
- **Task indicator** is a plain status element, not a link: there is no tasks page yet.
- **Command palette** is a single navigation group; grate's pane stack, recent items and
  game actions are gone.
- **Route tests** follow grate: e2e tests in `test/api/` boot `nuxt dev` against a
  migrated temp file database. They run as part of `pnpm test` (about 3 s here).
- **Settings config** has one real key, `missingAfterDays` (default 7, from the disk
  state section of [003](003-Architecture-and-data-model.md)), so `PATCH` has
  something to validate. Stored config is merged over defaults on read; `PATCH` rejects
  unknown keys and any attempt to set `enrolToken`.
- **No favicon or brand fonts** beyond Inter and JetBrains Mono; colours are Nuxt UI's
  `sky`/`zinc` defaults rather than grate's amber theme.

Where [003](003-Architecture-and-data-model.md) and
[004](004-Project-plan.md) turned out wrong or stale:

- 003's API list has `/api/health`; the route is `/health`, as grate, because the
  Docker `HEALTHCHECK` hits it.
- 003's compose sketch uses image `wjdp/tetanus`; the workflows publish
  `ghcr.io/wjdp/tetanus`, which `compose.yml` uses.
- 004 Phase 1 step 6 lists `000-Docs.md` project specifics; left to the docs owner.

## Done when

- `pnpm lint:ci`, `pnpm typecheck`, `pnpm test` (40 tests, 11 files) and `pnpm build`
  are green.
- `docker build .` succeeds and the container, run as an unprivileged user with only
  `./data` mounted, migrates on boot, answers `/health` and serves an enrol token from
  `/api/settings`.
- Each of the five pages renders under the layout with its own title.
