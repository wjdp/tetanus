import type { IngestSource } from "#shared/ingest";
import type { HostModel, HostPayload } from "./types";
import type { DemoWorld } from "./world";
import { hostPoolsAt } from "./zfsCommon";
import { renderZfsList, renderZfsSnapshots, snapshotsAt } from "./zfsDatasets";
import { renderZpoolEvents } from "./zpoolEvents";
import { renderZpoolHistory } from "./zpoolHistory";
import { renderZpoolList, renderZpoolStatus } from "./zpoolStatus";

const payload = (source: IngestSource, body: string): HostPayload => ({
  source,
  meta: {},
  body,
});

/**
 * The ZFS sources `tetanus-collect` posts for `host` at `t`. A host with no pools yet
 * posts nothing; `zpool-events` is left out while the event ring is empty.
 */
export function renderZfs(
  world: DemoWorld,
  host: HostModel,
  t: Date,
): HostPayload[] {
  if (hostPoolsAt(world, host, t).length === 0) return [];
  const snapshots = snapshotsAt(world, host, t);
  const events = renderZpoolEvents(world, host, t);
  return [
    payload("zpool-status", renderZpoolStatus(world, host, t)),
    payload("zpool-list", renderZpoolList(world, host, t)),
    payload("zfs-list", renderZfsList(world, host, t, snapshots)),
    payload("zfs-snapshots", renderZfsSnapshots(world, host, t, snapshots)),
    payload("zpool-history", renderZpoolHistory(world, host, t)),
    ...(events === null ? [] : [payload("zpool-events", events)]),
  ];
}
