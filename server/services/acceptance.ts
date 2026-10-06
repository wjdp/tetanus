import { and, desc, eq, isNull, lte } from "drizzle-orm";
import type { DiaryEventType } from "#shared/diary";
import {
  type AcceptanceKind,
  type AttributeStatus,
  isCovered,
  type OverlaidAttribute,
  worstStatus,
} from "#shared/smart/status";
import { db } from "~~/server/database/client";
import {
  disk,
  faultAcceptance,
  smartAttribute,
} from "~~/server/database/schema";
import { addAutoEvent } from "~~/server/services/diary";
import { setSmartAttributeFaultState } from "~~/server/services/faults";
import {
  latestAttributes,
  latestReading,
  recomputeLatestStatus,
  substituteAttributes,
} from "~~/server/services/smart";
import { notFound, ServiceError } from "~~/server/utils/serviceError";

export type FaultAcceptanceRow = typeof faultAcceptance.$inferSelect;

type NamedAttribute = OverlaidAttribute & { name: string };

export interface AcceptFaultInput {
  diskId: number;
  attrId: string;
  kind?: AcceptanceKind;
  note?: string;
  now?: Date;
}

interface KindVocabulary {
  verb: string;
  created: DiaryEventType;
  superseded: DiaryEventType;
  cleared: DiaryEventType;
  noun: string;
}

const KIND_VOCABULARY: Record<AcceptanceKind, KindVocabulary> = {
  accept: {
    verb: "accepted",
    created: "fault-accepted",
    superseded: "acceptance-superseded",
    cleared: "acceptance-cleared",
    noun: "acceptance",
  },
  acknowledge: {
    verb: "acknowledged",
    created: "fault-acknowledged",
    superseded: "acknowledgement-superseded",
    cleared: "acknowledgement-cleared",
    noun: "acknowledgement",
  },
};

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

function acceptableAttribute(diskId: number, attrId: string) {
  const evaluated = latestAttributes(diskId).find(
    (candidate) => candidate.attrId === attrId,
  );
  if (evaluated) return evaluated;
  const reading = latestReading(diskId);
  return reading
    ? substituteAttributes(diskId, reading.id).find(
        (candidate) => candidate.attrId === attrId,
      )
    : undefined;
}

export function acceptFault({
  diskId,
  attrId,
  kind = "accept",
  note = "",
  now = new Date(),
}: AcceptFaultInput): FaultAcceptanceRow {
  return db.transaction(() => {
    assertDiskExists(diskId);
    const vocabulary = KIND_VOCABULARY[kind];
    const active = activeAcceptances(diskId).get(attrId);
    if (active?.kind === kind) {
      throw new ServiceError(
        409,
        `Attribute ${attrId} on disk ${diskId} is already ${vocabulary.verb}`,
      );
    }
    const attribute = acceptableAttribute(diskId, attrId);
    if (!attribute) {
      throw notFound(
        `Disk ${diskId} has no attribute ${attrId} in its latest reading`,
      );
    }
    if (active) {
      db.update(faultAcceptance)
        .set({ clearedAt: now })
        .where(eq(faultAcceptance.id, active.id))
        .run();
    }
    const acceptedValue = attribute.transformedValue;
    const row = db
      .insert(faultAcceptance)
      .values({ diskId, attrId, kind, acceptedValue, acceptedAt: now, note })
      .returning()
      .get();
    addAutoEvent({
      subjectType: "disk",
      subjectId: diskId,
      eventType: vocabulary.created,
      title: `${vocabulary.verb} ${attribute.name} at ${acceptedValue}`,
      data: {
        attrId,
        acceptedValue,
        ...("trend" in attribute ? { trend: attribute.trend } : {}),
        note,
        ...(active ? { replaces: active.kind } : {}),
      },
      at: now,
    });
    recomputeLatestStatus(diskId, now, "acceptance");
    setSmartAttributeFaultState(diskId, attrId, { kind, note }, now);
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
    const vocabulary = KIND_VOCABULARY[active.kind];
    const row = db
      .update(faultAcceptance)
      .set({ clearedAt: now })
      .where(eq(faultAcceptance.id, active.id))
      .returning()
      .get();
    addAutoEvent({
      subjectType: "disk",
      subjectId: diskId,
      eventType: vocabulary.cleared,
      title: `cleared ${vocabulary.noun} of ${attrId} at ${active.acceptedValue}`,
      data: { attrId, acceptedValue: active.acceptedValue },
      at: now,
    });
    recomputeLatestStatus(diskId, now, "acceptance");
    setSmartAttributeFaultState(diskId, attrId, null, now);
    return row;
  });
}

function statusWhenAccepted(
  diskId: number,
  attrId: string,
  acceptedAt: Date,
): AttributeStatus | undefined {
  return db
    .select({ status: smartAttribute.status })
    .from(smartAttribute)
    .where(
      and(
        eq(smartAttribute.diskId, diskId),
        eq(smartAttribute.attrId, attrId),
        lte(smartAttribute.takenAt, acceptedAt),
      ),
    )
    .orderBy(desc(smartAttribute.takenAt), desc(smartAttribute.id))
    .limit(1)
    .get()?.status;
}

function hasWorsened(then: AttributeStatus | undefined, now: AttributeStatus) {
  return then !== undefined && then !== now && worstStatus(then, now) === now;
}

export function supersedeIfRisen(
  diskId: number,
  attributes: NamedAttribute[],
  now: Date,
): Set<string> {
  const byAttr = new Map(
    attributes.map((attribute) => [attribute.attrId, attribute]),
  );
  const superseded = new Set<string>();
  for (const active of activeAcceptances(diskId).values()) {
    const attribute = byAttr.get(active.attrId);
    if (!attribute) continue;
    const worsened = hasWorsened(
      statusWhenAccepted(diskId, active.attrId, active.acceptedAt),
      attribute.status,
    );
    if (
      !worsened &&
      isCovered(active.acceptedValue, attribute.transformedValue)
    ) {
      continue;
    }
    const value = attribute.transformedValue;
    const vocabulary = KIND_VOCABULARY[active.kind];
    db.update(faultAcceptance)
      .set({ supersededAt: now })
      .where(eq(faultAcceptance.id, active.id))
      .run();
    addAutoEvent({
      subjectType: "disk",
      subjectId: diskId,
      eventType: vocabulary.superseded,
      title: worsened
        ? `${attribute.name} worsened to ${attribute.status} at ${value} (${vocabulary.verb} at ${active.acceptedValue})`
        : `${attribute.name} rose to ${value} (${vocabulary.verb} at ${active.acceptedValue})`,
      data: {
        attrId: active.attrId,
        acceptedValue: active.acceptedValue,
        value,
      },
      at: now,
    });
    setSmartAttributeFaultState(diskId, active.attrId, null, now);
    superseded.add(active.attrId);
  }
  return superseded;
}
