---
type: task
status: done
---

# Name-based URLs for hosts pools and datasets

## Problem

Host, pool and dataset pages use database ids (`/hosts/1`, `/zfs/1`, `/datasets/2`). These URLs say nothing about what they point at and can't be typed from memory.

Goal: URLs built from the names the user already knows.

| Page | Now | Proposed |
| --- | --- | --- |
| Host | `/hosts/1` | `/hosts/nas1` |
| Pool | `/zfs/1` | `/zfs/nas1/tank` |
| Root dataset | `/datasets/2` | `/zfs/nas1/tank/~root` |
| Dataset | `/datasets/3` | `/zfs/nas1/tank/media/photos` |
| Older pool with the same name | `/zfs/4` | `/zfs/nas1/tank~249368` |

## Context

- `Host.name` is unique and never changes. `upsertHostByName` (`server/services/hosts.ts`) upserts on it, and `hostPatchSchema` allows only `displayName`, so host URLs are stable. There's already a precedent for names in URLs: `/faults?host=<hostName>` (`app/components/host/Faults.vue`).
- `Pool` is keyed by `guid`, a decimal u64 string. `name` is not unique per host: a destroyed and recreated pool is a new, unarchived row ([047](047-Archive-pools.md)), so two rows called `tank` can share a host.
- A pool exported from one host and imported on another keeps its row but its `hostId` changes ([003](003-Architecture-and-data-model.md)). Its URL moves to the new host, and the old URL may later resolve to a different pool.
- `Dataset` is unique on `(poolId, name)`, and `name` is the full ZFS name including the pool (`tank/media`). The root dataset's name is the pool name, so it would collide with the pool page without a suffix. The dataset page shows things the pool page doesn't (readings, snapshots, children), so the root dataset keeps its own page. Volumes (`type` zvol) follow the same rules. Snapshots have no page.
- OpenZFS `valid_char` allows alphanumerics plus `_ - . :` and space. `~` is rejected, so `~root` and `~<digits>` can't collide with a real name, whereas `_root` could. `encodeURIComponent` leaves `~` alone and encodes space and `:`. vue-router decodes params, including catch-all arrays.
- Faults and diary rows carry only `subjectType` and `subjectId`. Labels are joined server-side already: `describeSubject` (`server/services/faults.ts`) for faults, `labelSubjects` (`server/services/subjectLabels.ts`) for diary. Both handle removed subjects.
- Nuxt's `[...path]` matches zero or more segments and outranks `[id]`, so `zfs/[host]/[...path].vue` would make `zfs/[id].vue` unreachable.
- Pages poll; `shared/sse.ts` has no entity events, so there's nothing to invalidate.
- Tests, fixtures and docs use placeholder names (`nas1`, `tank`), never real host, pool or dataset names.

## Plan

1. **Path rules** in `shared/entityPaths.ts`:
   - `hostPath(name)` → `/hosts/<name>`.
   - Pool slug: among pools with the same name on a host, the canonical one (not archived, latest `lastSeenAt`) gets the bare name. Every other pool gets `<name>~<last 6 digits of guid>`.
   - `poolPath(hostName, slug)` → `/zfs/<host>/<slug>`.
   - `datasetPath(poolPath, datasetName)` → `poolPath` + the name without its pool prefix, or `/~root` for the root dataset.
   - `parseZfsPath(host, segments)` → `{ host, poolName, guidSuffix?, datasetRest? }`.
   - Every segment goes through `encodeURIComponent`.
2. **Server adds pool paths, client builds the rest.**
   - Only the pool path needs sibling pools. The server adds `path` to pool payloads and to pool references inside other payloads: dataset detail and search `pool`, replication endpoint `pool`, and `poolPath` on disk membership. It uses `poolPaths()` in `server/services/zfs/paths.ts`.
   - Clients build host and dataset paths with the helpers: `hostPath(name)` and `datasetPath(pool.path, name)`. `listDatasets` rows don't change; `DatasetTree` and `DatasetTreemap` take a `poolPath` prop.
   - `DiskOverview.vue` links the host by `hostName`.
3. **Lookup endpoints.**
   - `GET /api/zfs/[host]/[...path]` → `{ kind: "pool", pool } | { kind: "dataset", dataset }`, using the existing pool and dataset detail payloads. It's a service in `server/services/zfs/` (`resolveZfsPath`) and avoids a second round trip.
   - `GET /api/hosts/by-name/[name]` for the host page.
   - The id-based API stays for everything else: archive, config, the datasets tab, readings.
4. **Pages.**
   - `app/pages/hosts/[name].vue` replaces `[id].vue`. It takes the host id from the payload; today it does `Number(route.params.id)` for the pool and disk filters and the diary query.
   - `app/pages/zfs/[host]/[...path].vue` renders the pool page or the dataset page. An empty path redirects to `/hosts/<host>`.
   - The current page bodies move into `PoolPage` and `DatasetPage` components.
   - Delete `zfs/[id].vue` and `datasets/[id].vue`.
   - Drop `alsoActiveUnder: ["/datasets"]` in `app/utils/navigation.ts`.
5. **Legacy ids.** Nitro middleware in `server/middleware/` matches `^/(hosts|zfs|datasets)/(\d+)$`, looks the row up through the services and answers `sendRedirect(…, 302)` with no SSR render.
   - Use 302, not 301: an id's canonical path can change (archive, host move), and browsers cache 301s permanently.
   - A host whose name is all digits matches by name first.
6. **Links.** Replace every hand-built link with the helpers. From `rg -n "/zfs/|/datasets/|/hosts/" app shared` that's about 22 links:
   - Hosts pages and topology: `hosts/index.vue`, `hosts/add.vue`, `topology/HostSection.vue`, `topology/PoolCard.vue`.
   - ZFS and datasets: `zfs/index.vue`, `datasets/[id].vue` (pool link, children), `dataset/DatasetTree.vue`, `dataset/DatasetTreemap.vue`.
   - Disks and inventory: `disk/DiskOverview.vue`, `disk/DiskPoolBreadcrumb.vue`, `inventory/InventoryCell.vue`.
   - Replications: `replications/[id].vue`, `replication/SourcePanel.vue`.
   - Search: `AppCommandPalette.vue` (`useDatasetSearch` is in `app/components/dataset/`), `composables/useEntitySearch.ts`.
   - Faults and diary: `vocabulary/fault.ts` (`faultSubjectPath`), `diary/DiaryTimeline.vue` (`subjectLink`).
7. **Faults and diary.**
   - Add `subjectPath` in `describeSubject` and `labelSubjects`.
   - It's `null` for removed subjects, and for the `vdev` and `system` diary types.
   - `faultDiskPath` stays id-based.
8. **Tests.**
   - Unit tests for the path rules: disambiguation, `~root`, encoding of space and `:`, `tank/root` → `/zfs/nas1/tank/root`.
   - Seeded tests for `resolveZfsPath` and the legacy redirect, including a recreated pool, an archived pool and a moved pool.
   - Update the href assertions in:
     - `navigation.test.ts`, `AppBottomNav.test.ts`
     - `fault.test.ts`, `faults.test.ts`, `FaultRow.test.ts`, `DiaryTimeline.test.ts`
     - `useEntitySearch.test.ts`
     - `DatasetTree.test.ts`, `DatasetTreemap.test.ts`
     - `datasets/id.test.ts`, `zfs/[id].test.ts`
     - `hosts/id.test.ts`, `hosts/index.test.ts`
     - `disks/id.test.ts`, `disks/index.test.ts`
     - `replications/id.test.ts`
   - Page tests mount by route string, so they need name-based routes and the new endpoints mocked.

## Done when

- Every link to a host, pool or dataset uses the name-based path.
- Old id URLs redirect to it.
- Recreated, archived and moved pools with the same name each resolve to the right pool.

## Decisions

- The disambiguator is the last 6 digits of the guid. It's stable, and readability doesn't matter for the rare older pool. The leading digits of a u64 are less uniform than the trailing ones.
- The canonical pool's bare name can move to another pool when that pool is archived, unarchived, seen again, or moved between hosts. Accepted, because the id URLs still redirect with a 302.
- Disks stay on `/disks/<id>` and are out of scope. Serials can be malformed or duplicated (USB bridges, placeholder serials), so a serial-based path would need strong disambiguation. That needs its own task.
