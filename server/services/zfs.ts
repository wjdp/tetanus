import type { IngestSource } from "#shared/ingest";
import type { IngestHandler } from "~~/server/ingest/handlers";
import type { ZedEventResult } from "~~/server/ingest/zed-event";
import type { ZfsListResult } from "~~/server/ingest/zfs-list";
import type { ZfsSnapshotsResult } from "~~/server/ingest/zfs-snapshots";
import type { ZpoolEventsResult } from "~~/server/ingest/zpool-events";
import type { ZpoolHistoryResult } from "~~/server/ingest/zpool-history";
import type { ZpoolListResult } from "~~/server/ingest/zpool-list";
import type { ZpoolStatusResult } from "~~/server/ingest/zpool-status";
import { observeZfsList, observeZfsSnapshots } from "./zfs/datasets";
import { observeZfsEvents } from "./zfs/events";
import { observeZpoolHistory } from "./zfs/history";
import { observeZpoolList, observeZpoolStatus } from "./zfs/topology";

export {
  type DatasetIngestSummary,
  type DatasetReadingRow,
  type DatasetRow,
  observeZfsList,
  observeZfsSnapshots,
  type SnapshotRow,
} from "./zfs/datasets";
export { observeZfsEvents } from "./zfs/events";
export { observeZpoolHistory } from "./zfs/history";
export * from "./zfs/queries";
export {
  observeZpoolList,
  observeZpoolStatus,
  type PoolRow,
  resolveLeafDiskId,
  type VdevRow,
} from "./zfs/topology";

const zpoolStatus: IngestHandler<ZpoolStatusResult> = ({
  hostId,
  data,
  receivedAt,
}) => {
  observeZpoolStatus(hostId, data, receivedAt);
};

const zpoolList: IngestHandler<ZpoolListResult> = ({ data }) => {
  observeZpoolList(data);
};

const zpoolEvents: IngestHandler<ZpoolEventsResult> = ({
  hostId,
  data,
  receivedAt,
}) => {
  observeZfsEvents(hostId, data.events, receivedAt);
};

const zedEvent: IngestHandler<ZedEventResult> = ({
  hostId,
  data,
  receivedAt,
}) => {
  observeZfsEvents(hostId, [data.event], receivedAt);
};

const zpoolHistory: IngestHandler<ZpoolHistoryResult> = ({ hostId, data }) => {
  observeZpoolHistory(hostId, data);
};

const zfsList: IngestHandler<ZfsListResult> = ({
  hostId,
  data,
  receivedAt,
}) => {
  observeZfsList(hostId, data, receivedAt);
};

const zfsSnapshots: IngestHandler<ZfsSnapshotsResult> = ({
  hostId,
  data,
  receivedAt,
}) => {
  observeZfsSnapshots(hostId, data, receivedAt);
};

// biome-ignore lint/suspicious/noExplicitAny: each handler narrows data to its own parser's output
export const ZFS_HANDLERS: Partial<Record<IngestSource, IngestHandler<any>>> = {
  "zpool-status": zpoolStatus,
  "zpool-list": zpoolList,
  "zpool-events": zpoolEvents,
  "zed-event": zedEvent,
  "zpool-history": zpoolHistory,
  "zfs-list": zfsList,
  "zfs-snapshots": zfsSnapshots,
};
