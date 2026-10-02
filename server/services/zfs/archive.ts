import { eq } from "drizzle-orm";
import { db } from "~~/server/database/client";
import { pool } from "~~/server/database/schema";
import { addAutoEvent } from "~~/server/services/diary";
import {
  notifyFaultsChanged,
  resolvePoolFaults,
} from "~~/server/services/faults";
import { notFound, ServiceError } from "~~/server/utils/serviceError";
import { getPool, type PoolDetail } from "./queries";

export const ARCHIVED_FAULT_REASON = "archived";

function poolRow(id: number) {
  const row = db.select().from(pool).where(eq(pool.id, id)).get();
  if (!row) throw notFound(`Pool ${id} not found`);
  return row;
}

export function archivePool(
  id: number,
  note = "",
  now = new Date(),
): PoolDetail {
  const resolved = db.transaction(() => {
    const row = poolRow(id);
    if (row.archivedAt) {
      throw new ServiceError(409, `Pool ${row.name} is already archived`);
    }
    db.update(pool)
      .set({ archivedAt: now, archiveNote: note })
      .where(eq(pool.id, id))
      .run();
    addAutoEvent({
      subjectType: "pool",
      subjectId: id,
      eventType: "pool-archived",
      title: note ? `${row.name} archived: ${note}` : `${row.name} archived`,
      data: { note },
      at: now,
    });
    return resolvePoolFaults(id, ARCHIVED_FAULT_REASON, now);
  });
  if (resolved > 0) notifyFaultsChanged();
  return getPool(id, now);
}

export function unarchivePool(id: number, now = new Date()): PoolDetail {
  db.transaction(() => {
    const row = poolRow(id);
    if (!row.archivedAt) {
      throw new ServiceError(409, `Pool ${row.name} is not archived`);
    }
    db.update(pool)
      .set({ archivedAt: null, archiveNote: "" })
      .where(eq(pool.id, id))
      .run();
    addAutoEvent({
      subjectType: "pool",
      subjectId: id,
      eventType: "pool-unarchived",
      title: `${row.name} unarchived`,
      at: now,
    });
  });
  return getPool(id, now);
}
