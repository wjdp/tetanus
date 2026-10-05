import { and, eq } from "drizzle-orm";
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
  | { ok: false; error: string; reported?: true };

const STDERR_LINES = 3;

/** Sources posted once per event rather than per run: only the latest run is kept. */
const LATEST_RUN_ONLY_SOURCES: ReadonlySet<IngestSource> = new Set([
  "zed-event",
]);

type CollectorRunValues = typeof collectorRun.$inferInsert;

function recordRun(values: CollectorRunValues) {
  if (LATEST_RUN_ONLY_SOURCES.has(values.source as IngestSource)) {
    db.delete(collectorRun)
      .where(
        and(
          eq(collectorRun.hostId, values.hostId),
          eq(collectorRun.source, values.source),
        ),
      )
      .run();
  }
  db.insert(collectorRun).values(values).run();
}

function commandFailure(status: number, stderr: string) {
  const lines = stderr
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, STDERR_LINES);
  const exited = `Command exited ${status}`;
  return lines.length > 0 ? `${exited}: ${lines.join(" / ")}` : exited;
}

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

  if (meta.failed !== undefined) {
    const error = commandFailure(meta.failed, body);
    recordRun({ ...run, exitStatus: meta.failed, ok: false, error });
    return { ok: false, error, reported: true };
  }

  let parsed: ReturnType<(typeof PARSERS)[typeof source]>;
  try {
    parsed = PARSERS[source](body, meta);
  } catch (error) {
    const message = describeError(error);
    recordRun({ ...run, ok: false, error: message });
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
    recordRun({ ...run, ok: true, error: handlerError });
  });

  void requestAlertsTick();
  return { ok: true, source, host: hostRow.name, summary: parsed.summary };
}
