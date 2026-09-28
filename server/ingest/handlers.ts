import type { IngestMeta, IngestSource } from "#shared/ingest";
import { setToolVersions } from "~~/server/services/hosts";
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

// biome-ignore lint/suspicious/noExplicitAny: each handler narrows data to its own parser's output
export const HANDLERS: Partial<Record<IngestSource, IngestHandler<any>>> = {
  versions,
};
