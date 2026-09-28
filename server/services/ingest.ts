import {
  type IngestMeta,
  type IngestSummary,
  isIngestSource,
} from "#shared/ingest";
import { db } from "~~/server/database/client";
import { collectorRun, NO_DEVICE, payload } from "~~/server/database/schema";
import { PARSERS } from "~~/server/ingest/registry";
import type { ToolVersions } from "~~/server/ingest/versions";
import { setToolVersions, upsertHostByName } from "~~/server/services/hosts";
import { invalidRequest } from "~~/server/utils/serviceError";

export interface IngestRequest {
  hostName: string;
  source: string;
  meta: IngestMeta;
  body: string;
  producer?: string | null;
  receivedAt?: Date;
}

export type IngestOutcome =
  | { ok: true; source: string; host: string; summary: IngestSummary }
  | { ok: false; error: string };

function describeParseFailure(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export function recordIngest({
  hostName,
  source,
  meta,
  body,
  producer = null,
  receivedAt = new Date(),
}: IngestRequest): IngestOutcome {
  const hostRow = upsertHostByName(hostName, receivedAt);
  if (!isIngestSource(source)) {
    throw invalidRequest(`Unknown ingest source: ${source}`);
  }

  const run = {
    hostId: hostRow.id,
    source,
    device: meta.device ?? null,
    deviceType: meta.type ?? null,
    exitStatus: meta.exitStatus ?? null,
    receivedAt,
    bytes: Buffer.byteLength(body, "utf8"),
    producer,
  };

  let parsed: ReturnType<(typeof PARSERS)[typeof source]>;
  try {
    parsed = PARSERS[source](body, meta);
  } catch (error) {
    const message = describeParseFailure(error);
    db.insert(collectorRun)
      .values({ ...run, ok: false, error: message })
      .run();
    return { ok: false, error: message };
  }

  db.transaction(() => {
    db.insert(payload)
      .values({
        hostId: hostRow.id,
        source,
        device: meta.device ?? NO_DEVICE,
        receivedAt,
        body,
      })
      .onConflictDoUpdate({
        target: [payload.hostId, payload.source, payload.device],
        set: { receivedAt, body },
      })
      .run();
    db.insert(collectorRun)
      .values({ ...run, ok: true })
      .run();
    if (source === "versions") {
      setToolVersions(hostRow.id, parsed.data as ToolVersions);
    }
  });

  return { ok: true, source, host: hostRow.name, summary: parsed.summary };
}
