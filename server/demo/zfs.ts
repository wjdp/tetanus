import type { IngestSource } from "#shared/ingest";
import type { HostModel, HostPayload } from "./types";
import type { DemoWorld } from "./world";
import { hostPoolsAt } from "./zfsCommon";
import { renderZfsList, renderZfsSnapshots, snapshotsAt } from "./zfsDatasets";
import { renderZpoolEvents } from "./zpoolEvents";
import { renderZfsReceives, renderZpoolHistory } from "./zpoolHistory";
import { renderZpoolList, renderZpoolStatus } from "./zpoolStatus";

const payload = (source: IngestSource, body: string): HostPayload => ({
  source,
  meta: {},
  body,
});

/**
 * The ZFS sources `tetanus-collect` posts for `host` at `t`. A host with no pools yet
 * posts nothing; `zpool-events` is left out while the event ring is empty.
 * `datasets: false` leaves out `zfs-list` and `zfs-snapshots` (the replay posts those once).
 */
export function renderZfs(
  world: DemoWorld,
  host: HostModel,
  t: Date,
  { datasets = true }: { datasets?: boolean } = {},
): HostPayload[] {
  if (hostPoolsAt(world, host, t).length === 0) return [];
  const events = renderZpoolEvents(world, host, t);
  const snapshots = datasets ? snapshotsAt(world, host, t) : [];
  return [
    payload("zpool-status", renderZpoolStatus(world, host, t)),
    payload("zpool-list", renderZpoolList(world, host, t)),
    ...(datasets
      ? [
          payload("zfs-list", renderZfsList(world, host, t, snapshots)),
          payload(
            "zfs-snapshots",
            renderZfsSnapshots(world, host, t, snapshots),
          ),
        ]
      : []),
    payload("zpool-history", renderZpoolHistory(world, host, t)),
    payload("zfs-receives", renderZfsReceives(world, host, t)),
    ...(events === null ? [] : [payload("zpool-events", events)]),
  ];
}
