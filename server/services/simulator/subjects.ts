import { eq } from "drizzle-orm";
import { isDisposed, isHistoryState } from "#shared/disk";
import type { SimulationSubjectType } from "#shared/simulator";
import { db } from "~~/server/database/client";
import {
  dataset,
  disk,
  host,
  pool,
  replication,
} from "~~/server/database/schema";
import { notFound } from "~~/server/utils/serviceError";
import { storedPayloads } from "./payloads";
import { serialOf } from "./smartctl";
import type { HostRow, Subject, SubjectOf } from "./types";

function hostRow(id: number | null): HostRow | undefined {
  if (id === null) return undefined;
  return db.select().from(host).where(eq(host.id, id)).get();
}

function datasetHost(datasetId: number) {
  return db
    .select({ host, poolArchivedAt: pool.archivedAt })
    .from(dataset)
    .innerJoin(pool, eq(pool.id, dataset.poolId))
    .innerJoin(host, eq(host.id, pool.hostId))
    .where(eq(dataset.id, datasetId))
    .get();
}

/**
 * The subject with the host that collects it; undefined for a disk out of
 * service or with no host, and for an archived replication.
 */
export function loadSubject(
  type: SimulationSubjectType,
  id: number,
): Subject | undefined {
  if (type === "host") {
    const row = hostRow(id);
    if (!row) throw notFound(`No host ${id}`);
    return { type, host: row };
  }
  if (type === "pool") {
    const row = db.select().from(pool).where(eq(pool.id, id)).get();
    if (!row) throw notFound(`No pool ${id}`);
    const owner = hostRow(row.hostId);
    return owner && { type, pool: row, host: owner };
  }
  if (type === "replication") {
    const row = db
      .select()
      .from(replication)
      .where(eq(replication.id, id))
      .get();
    if (!row) throw notFound(`No replication ${id}`);
    const target = datasetHost(row.targetDatasetId);
    if (!target || row.archivedAt || target.poolArchivedAt) return undefined;
    return { type, replication: row, host: target.host };
  }
  const row = db.select().from(disk).where(eq(disk.id, id)).get();
  if (!row) throw notFound(`No disk ${id}`);
  if (isHistoryState(row.stateOverride) || isDisposed(row)) return undefined;
  const owner = hostRow(row.lastSeenHostId);
  return owner && { type, disk: row, host: owner };
}

export function smartctlPayloadOf(subject: SubjectOf<"disk">) {
  const { serial } = subject.disk;
  if (!serial) return undefined;
  return storedPayloads(subject.host.id, "smartctl-xall").find(
    (stored) => serialOf(stored.body) === serial,
  );
}

/** The host collecting a dataset's pool. */
export function hostOfDataset(datasetId: number): HostRow | undefined {
  return datasetHost(datasetId)?.host;
}
