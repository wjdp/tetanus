import { and, count, desc, eq, type SQL } from "drizzle-orm";
import type { DiaryEventType, DiarySubjectType } from "#shared/diary";
import type {
  DiaryEntryInput,
  DiaryEntryPatch,
  DiaryQuery,
} from "#shared/schemas/diary";
import { db } from "~~/server/database/client";
import { diaryEntry } from "~~/server/database/schema";
import { notFound, ServiceError } from "~~/server/utils/serviceError";

export type DiaryEntryRow = typeof diaryEntry.$inferSelect;

export const DEFAULT_DIARY_LIMIT = 100;

export interface AutoEvent {
  subjectType: DiarySubjectType;
  subjectId: number | null;
  eventType: DiaryEventType;
  title: string;
  body?: string;
  data?: Record<string, unknown>;
  at?: Date;
}

export function addAutoEvent({
  subjectType,
  subjectId,
  eventType,
  title,
  body = "",
  data = {},
  at = new Date(),
}: AutoEvent): DiaryEntryRow {
  return db
    .insert(diaryEntry)
    .values({
      subjectType,
      subjectId,
      at,
      kind: "auto",
      eventType,
      title,
      body,
      data,
    })
    .returning()
    .get();
}

export function addManualEntry({
  subjectType,
  subjectId = null,
  title,
  body = "",
  at = new Date(),
}: DiaryEntryInput): DiaryEntryRow {
  return db
    .insert(diaryEntry)
    .values({ subjectType, subjectId, at, kind: "manual", title, body })
    .returning()
    .get();
}

export function listDiary({
  subjectType,
  subjectId,
  limit = DEFAULT_DIARY_LIMIT,
}: Partial<DiaryQuery> = {}): DiaryEntryRow[] {
  const filters: SQL[] = [];
  if (subjectType) filters.push(eq(diaryEntry.subjectType, subjectType));
  if (subjectId !== undefined)
    filters.push(eq(diaryEntry.subjectId, subjectId));
  return db
    .select()
    .from(diaryEntry)
    .where(and(...filters))
    .orderBy(desc(diaryEntry.at), desc(diaryEntry.id))
    .limit(limit)
    .all();
}

export function countDiary(
  subjectType: DiarySubjectType,
  subjectId: number,
): number {
  return (
    db
      .select({ total: count() })
      .from(diaryEntry)
      .where(
        and(
          eq(diaryEntry.subjectType, subjectType),
          eq(diaryEntry.subjectId, subjectId),
        ),
      )
      .get()?.total ?? 0
  );
}

export function latestAutoEvent(
  subjectType: DiarySubjectType,
  subjectId: number,
  eventType: DiaryEventType,
): DiaryEntryRow | undefined {
  return db
    .select()
    .from(diaryEntry)
    .where(
      and(
        eq(diaryEntry.subjectType, subjectType),
        eq(diaryEntry.subjectId, subjectId),
        eq(diaryEntry.eventType, eventType),
      ),
    )
    .orderBy(desc(diaryEntry.at), desc(diaryEntry.id))
    .limit(1)
    .get();
}

function manualEntry(id: number): DiaryEntryRow {
  const row = db.select().from(diaryEntry).where(eq(diaryEntry.id, id)).get();
  if (!row) throw notFound(`Diary entry ${id} not found`);
  if (row.kind !== "manual") {
    throw new ServiceError(403, `Diary entry ${id} is automatic`);
  }
  return row;
}

export function updateManualEntry(
  id: number,
  patch: DiaryEntryPatch,
): DiaryEntryRow {
  const row = manualEntry(id);
  const changes = Object.fromEntries(
    Object.entries(patch).filter(([, value]) => value !== undefined),
  );
  if (Object.keys(changes).length === 0) return row;
  return db
    .update(diaryEntry)
    .set(changes)
    .where(eq(diaryEntry.id, id))
    .returning()
    .get();
}

export function deleteManualEntry(id: number) {
  manualEntry(id);
  db.delete(diaryEntry).where(eq(diaryEntry.id, id)).run();
}
