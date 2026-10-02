import { and, desc, eq, isNull } from "drizzle-orm";
import type { IngestMeta, IngestSource } from "#shared/ingest";
import { db } from "~~/server/database/client";
import { collectorRun, NO_DEVICE, payload } from "~~/server/database/schema";

export interface StoredPayload {
  source: IngestSource;
  device: string;
  meta: IngestMeta;
  producer: string | null;
  body: string;
}

function latestRun(hostId: number, source: IngestSource, device: string) {
  return db
    .select()
    .from(collectorRun)
    .where(
      and(
        eq(collectorRun.hostId, hostId),
        eq(collectorRun.source, source),
        eq(collectorRun.ok, true),
        device === NO_DEVICE
          ? isNull(collectorRun.device)
          : eq(collectorRun.device, device),
      ),
    )
    .orderBy(desc(collectorRun.receivedAt), desc(collectorRun.id))
    .limit(1)
    .get();
}

/** The latest stored body of each device for this source, with the meta and producer it was posted with. */
export function storedPayloads(
  hostId: number,
  source: IngestSource,
): StoredPayload[] {
  return db
    .select()
    .from(payload)
    .where(and(eq(payload.hostId, hostId), eq(payload.source, source)))
    .orderBy(payload.device)
    .all()
    .map((row) => {
      const run = latestRun(hostId, source, row.device);
      return {
        source,
        device: row.device,
        meta: {
          device: row.device === NO_DEVICE ? undefined : row.device,
          type: run?.deviceType ?? undefined,
          exitStatus: run?.exitStatus ?? undefined,
        },
        producer: run?.producer ?? null,
        body: row.body,
      };
    });
}

export function storedPayload(
  hostId: number,
  source: IngestSource,
): StoredPayload | undefined {
  return storedPayloads(hostId, source)[0];
}
