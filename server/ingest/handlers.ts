import type { IngestMeta, IngestSource } from "#shared/ingest";
import {
  applyVdevIdConf,
  observeDiskFromSmartctl,
  observeLsblk,
  observeUdev,
} from "~~/server/services/disks";
import { setToolVersions } from "~~/server/services/hosts";
import {
  observeEnclosures,
  observeUdevLocation,
} from "~~/server/services/locations";
import { recordSmartReading } from "~~/server/services/smart";
import { ZFS_HANDLERS } from "~~/server/services/zfs";
import type { EnclosureResult } from "./enclosure";
import type { LsblkResult } from "./lsblk";
import type { SmartctlXallResult } from "./smartctl-xall";
import type { UdevResult } from "./udev";
import type { VdevIdConfResult } from "./vdev-id-conf";
import type { ToolVersions } from "./versions";

export interface IngestContext<T> {
  hostId: number;
  hostName: string;
  receivedAt: Date;
  meta: IngestMeta;
  data: T;
  body: string;
}

export type IngestHandler<T = unknown> = (ctx: IngestContext<T>) => void;

const versions: IngestHandler<ToolVersions> = ({ hostId, data }) => {
  setToolVersions(hostId, data);
};

const lsblk: IngestHandler<LsblkResult> = ({ hostId, data, receivedAt }) => {
  observeLsblk(hostId, data, receivedAt);
};

const udev: IngestHandler<UdevResult> = ({ hostId, data, receivedAt }) => {
  const row = observeUdev(hostId, data, receivedAt);
  if (row) observeUdevLocation(row, hostId, data, receivedAt);
};

const enclosure: IngestHandler<EnclosureResult> = ({
  hostId,
  data,
  receivedAt,
}) => {
  observeEnclosures(hostId, data, receivedAt);
};

const vdevIdConf: IngestHandler<VdevIdConfResult> = ({ data, receivedAt }) => {
  applyVdevIdConf(data, receivedAt);
};

const smartctlXall: IngestHandler<SmartctlXallResult> = ({
  hostId,
  meta,
  data,
  body,
  receivedAt,
}) => {
  const observed = observeDiskFromSmartctl(hostId, meta, data, receivedAt);
  if (!observed) return;
  recordSmartReading({
    disk: observed,
    hostId,
    meta,
    parsed: data,
    body,
    receivedAt,
  });
};

// biome-ignore lint/suspicious/noExplicitAny: each handler narrows data to its own parser's output
export const HANDLERS: Partial<Record<IngestSource, IngestHandler<any>>> = {
  versions,
  lsblk,
  udev,
  enclosure,
  "vdev-id-conf": vdevIdConf,
  "smartctl-xall": smartctlXall,
  ...ZFS_HANDLERS,
};
