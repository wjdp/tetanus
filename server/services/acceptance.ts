import { and, desc, eq, isNull } from "drizzle-orm";
import type { OverlaidAttribute } from "#shared/smart/status";
import { db } from "~~/server/database/client";
import { disk, faultAcceptance } from "~~/server/database/schema";
import { addAutoEvent } from "~~/server/services/diary";
import {
  latestAttributes,
  recomputeLatestStatus,
} from "~~/server/services/smart";
import { notFound, ServiceError } from "~~/server/utils/serviceError";

export type FaultAcceptanceRow = typeof faultAcceptance.$inferSelect;

type NamedAttribute = OverlaidAttribute & { name: string };

export interface AcceptFaultInput {
  diskId: number;
  attrId: string;
  note?: string;
  now?: Date;
}

function isActive(diskId: number) {
  return and(
    eq(faultAcceptance.diskId, diskId),
    isNull(faultAcceptance.supersededAt),
    isNull(faultAcceptance.clearedAt),
  );
}

export function activeAcceptances(
  diskId: number,
): Map<string, FaultAcceptanceRow> {
  const rows = db
    .select()
    .from(faultAcceptance)
    .where(isActive(diskId))
    .orderBy(faultAcceptance.id)
    .all();
  return new Map(rows.map((row) => [row.attrId, row]));
}

export function listAcceptances(diskId: number): FaultAcceptanceRow[] {
  return db
    .select()
    .from(faultAcceptance)
    .where(eq(faultAcceptance.diskId, diskId))
    .orderBy(desc(faultAcceptance.acceptedAt), desc(faultAcceptance.id))
    .all();
}

function assertDiskExists(diskId: number) {
  const found = db
    .select({ id: disk.id })
    .from(disk)
    .where(eq(disk.id, diskId))
    .get();
  if (!found) throw notFound(`Disk ${diskId} not found`);
}

export function acceptFault({
  diskId,
  attrId,
  note = "",
  now = new Date(),
}: AcceptFaultInput): FaultAcceptanceRow {
  return db.transaction(() => {
    assertDiskExists(diskId);
    if (activeAcceptances(diskId).has(attrId)) {
      throw new ServiceError(
        409,
        `Attribute ${attrId} on disk ${diskId} is already accepted`,
      );
    }
    const attribute = latestAttributes(diskId).find(
      (candidate) => candidate.attrId === attrId,
    );
    if (!attribute) {
      throw notFound(
        `Disk ${diskId} has no attribute ${attrId} in its latest reading`,
      );
    }
    const acceptedValue = attribute.transformedValue;
    const row = db
      .insert(faultAcceptance)
      .values({ diskId, attrId, acceptedValue, acceptedAt: now, note })
      .returning()
      .get();
    addAutoEvent({
      subjectType: "disk",
      subjectId: diskId,
      eventType: "fault-accepted",
      title: `accepted ${attribute.name} at ${acceptedValue}`,
      data: { attrId, acceptedValue, trend: attribute.trend, note },
      at: now,
    });
    recomputeLatestStatus(diskId, now);
    return row;
  });
}

export function clearAcceptance(
  diskId: number,
  attrId: string,
  now = new Date(),
): FaultAcceptanceRow {
  return db.transaction(() => {
    const active = activeAcceptances(diskId).get(attrId);
    if (!active) {
      throw notFound(
        `Attribute ${attrId} on disk ${diskId} has no active acceptance`,
      );
    }
    const row = db
      .update(faultAcceptance)
      .set({ clearedAt: now })
      .where(eq(faultAcceptance.id, active.id))
      .returning()
      .get();
    addAutoEvent({
      subjectType: "disk",
      subjectId: diskId,
      eventType: "acceptance-cleared",
      title: `cleared acceptance of ${attrId} at ${active.acceptedValue}`,
      data: { attrId, acceptedValue: active.acceptedValue },
      at: now,
    });
    recomputeLatestStatus(diskId, now);
    return row;
  });
}

export function supersedeIfRisen(
  diskId: number,
  attributes: NamedAttribute[],
  now: Date,
) {
  const byAttr = new Map(
    attributes.map((attribute) => [attribute.attrId, attribute]),
  );
  for (const active of activeAcceptances(diskId).values()) {
    const attribute = byAttr.get(active.attrId);
    if (!attribute || attribute.transformedValue <= active.acceptedValue) {
      continue;
    }
    const value = attribute.transformedValue;
    db.update(faultAcceptance)
      .set({ supersededAt: now })
      .where(eq(faultAcceptance.id, active.id))
      .run();
    addAutoEvent({
      subjectType: "disk",
      subjectId: diskId,
      eventType: "acceptance-superseded",
      title: `${attribute.name} rose to ${value} (accepted at ${active.acceptedValue})`,
      data: {
        attrId: active.attrId,
        acceptedValue: active.acceptedValue,
        value,
      },
      at: now,
    });
  }
}
