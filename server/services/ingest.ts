import { parseCollectorProducer } from "#shared/collector";
import {
  type IngestMeta,
  type IngestSource,
  type IngestSummary,
  isIngestSource,
} from "#shared/ingest";
import { db } from "~~/server/database/client";
import { collectorRun, NO_DEVICE, payload } from "~~/server/database/schema";
import { HANDLERS, type IngestContext } from "~~/server/ingest/handlers";
import { PARSERS } from "~~/server/ingest/registry";
import {
  recordCollectorVersion,
  upsertHostByName,
} from "~~/server/services/hosts";
import { requestAlertsTick } from "~~/server/tasks/queueable/alertsTick";
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

function describeError(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function runHandler(
  source: IngestSource,
  context: IngestContext<unknown>,
): string | null {
  const handler = HANDLERS[source];
  if (!handler) return null;
  try {
    db.transaction(() => handler(context));
    return null;
  } catch (error) {
    console.error(
      `Ingest handler for ${source} from ${context.hostName} failed`,
      error,
    );
    return describeError(error);
  }
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
  const collectorVersion = parseCollectorProducer(producer);
  if (collectorVersion) {
    recordCollectorVersion(hostRow, collectorVersion, receivedAt);
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
    const message = describeError(error);
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
    const handlerError = runHandler(source, {
      hostId: hostRow.id,
      hostName: hostRow.name,
      receivedAt,
      meta,
      data: parsed.data,
      body,
    });
    db.insert(collectorRun)
      .values({ ...run, ok: true, error: handlerError })
      .run();
  });

  void requestAlertsTick();
  return { ok: true, source, host: hostRow.name, summary: parsed.summary };
}
