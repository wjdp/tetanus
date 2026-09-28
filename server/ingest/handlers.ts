import type { IngestMeta, IngestSource } from "#shared/ingest";
import {
  applyVdevIdConf,
  observeLsblk,
  observeUdev,
} from "~~/server/services/disks";
import { setToolVersions } from "~~/server/services/hosts";
import type { LsblkResult } from "./lsblk";
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
  observeUdev(hostId, data, receivedAt);
};

const vdevIdConf: IngestHandler<VdevIdConfResult> = ({ data, receivedAt }) => {
  applyVdevIdConf(data, receivedAt);
};

// biome-ignore lint/suspicious/noExplicitAny: each handler narrows data to its own parser's output
export const HANDLERS: Partial<Record<IngestSource, IngestHandler<any>>> = {
  versions,
  lsblk,
  udev,
  "vdev-id-conf": vdevIdConf,
};
