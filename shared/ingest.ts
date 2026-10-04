import { z } from "zod";
import { APP_NAME } from "./app";

export const INGEST_SOURCES = [
  "versions",
  "smartctl-scan",
  "smartctl-xall",
  "lsblk",
  "udev",
  "enclosure",
  "vdev-id-conf",
  "zpool-status",
  "zpool-list",
  "zfs-list",
  "zfs-snapshots",
  "zpool-history",
  "zfs-receives",
  "zpool-events",
  "zed-event",
] as const;

export type IngestSource = (typeof INGEST_SOURCES)[number];

export function isIngestSource(value: string): value is IngestSource {
  return (INGEST_SOURCES as readonly string[]).includes(value);
}

export const titleCase = (word: string) =>
  word.charAt(0).toUpperCase() + word.slice(1);

export const HOST_HEADER = `${titleCase(APP_NAME)}-Host`;

export const INGEST_BODY_LIMIT_BYTES = 16 * 1024 * 1024;

export const hostNameSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9][a-z0-9.-]{0,62}$/, "Invalid host name");

const queryText = z.string().trim().min(1).max(256);

const exitStatus = z
  .string()
  .regex(/^\d{1,3}$/, "exit status must be an integer")
  .transform(Number)
  .pipe(z.number().int().min(0).max(255));

export const ingestMetaSchema = z.object({
  device: queryText.optional(),
  type: queryText.optional(),
  exitStatus: exitStatus.optional(),
  failed: exitStatus.optional(),
});

export type IngestMeta = z.infer<typeof ingestMetaSchema>;

export type IngestSummary = Record<string, string | number>;

export interface IngestResult<T> {
  data: T;
  summary: IngestSummary;
}

export type Parser<T> = (body: string, meta: IngestMeta) => IngestResult<T>;
