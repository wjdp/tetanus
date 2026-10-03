import { eq } from "drizzle-orm";
import type { ReplicationPatch } from "#shared/schemas/replications";
import { db } from "~~/server/database/client";
import { dataset, replication } from "~~/server/database/schema";
import { addAutoEvent } from "~~/server/services/diary";
import {
  notifyFaultsChanged,
  resolveReplicationFaults,
} from "~~/server/services/faults";
import { invalidRequest, notFound } from "~~/server/utils/serviceError";
import { getReplication, type ReplicationDetail } from "./detail";
import { REPLICATION_ARCHIVED_REASON } from "./faults";
import { resolveReplicationSources } from "./sources";

type ReplicationRow = typeof replication.$inferSelect;

function datasetName(id: number) {
  return db
    .select({ name: dataset.name })
    .from(dataset)
    .where(eq(dataset.id, id))
    .get()?.name;
}

function sourceChange(
  row: ReplicationRow,
  sourceDatasetId: number | null,
): Partial<ReplicationRow> {
  if (sourceDatasetId === null) {
    return { sourceDatasetId: null, direction: "received" };
  }
  if (sourceDatasetId === row.targetDatasetId) {
    throw invalidRequest("A replication cannot be its own source");
  }
  if (datasetName(sourceDatasetId) === undefined) {
    throw invalidRequest(`Dataset ${sourceDatasetId} not found`);
  }
  return { sourceDatasetId, direction: "manual" };
}

function archive(row: ReplicationRow, target: string, note: string, now: Date) {
  addAutoEvent({
    subjectType: "replication",
    subjectId: row.id,
    eventType: "replication-archived",
    title: note
      ? `Replication into ${target} archived: ${note}`
      : `Replication into ${target} archived`,
    data: { note },
    at: now,
  });
  return resolveReplicationFaults(row.id, REPLICATION_ARCHIVED_REASON, now);
}

function unarchive(row: ReplicationRow, target: string, now: Date) {
  addAutoEvent({
    subjectType: "replication",
    subjectId: row.id,
    eventType: "replication-resumed",
    title: `Replication into ${target} unarchived`,
    data: { archivedAt: row.archivedAt?.toISOString() ?? null },
    at: now,
  });
}

/**
 * A source set by hand makes the replication manual; null hands it back to
 * discovery. Archiving resolves its faults; a later sync un-archives it.
 */
export function updateReplication(
  id: number,
  patch: ReplicationPatch,
  now = new Date(),
): ReplicationDetail {
  const resolved = db.transaction(() => {
    const row = db
      .select()
      .from(replication)
      .where(eq(replication.id, id))
      .get();
    if (!row) throw notFound(`Replication ${id} not found`);
    const target = datasetName(row.targetDatasetId) ?? "";
    const changes: Partial<ReplicationRow> = {
      ...(patch.sourceDatasetId === undefined
        ? {}
        : sourceChange(row, patch.sourceDatasetId)),
      ...(patch.manualIntervalSec === undefined
        ? {}
        : { manualIntervalSec: patch.manualIntervalSec }),
    };
    let resolvedFaults = 0;
    if (patch.archived === true) {
      const note = patch.archivedNote ?? "";
      changes.archivedNote = note;
      if (row.archivedAt === null) {
        changes.archivedAt = now;
        resolvedFaults = archive(row, target, note, now);
      }
    } else if (patch.archived === false && row.archivedAt !== null) {
      Object.assign(changes, { archivedAt: null, archivedNote: "" });
      unarchive(row, target, now);
    }
    if (Object.keys(changes).length > 0) {
      db.update(replication).set(changes).where(eq(replication.id, id)).run();
    }
    if (patch.sourceDatasetId === null) resolveReplicationSources();
    return resolvedFaults;
  });
  if (resolved > 0) notifyFaultsChanged();
  return getReplication(id, {}, now);
}
