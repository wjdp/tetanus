import { and, desc, eq, type SQL } from "drizzle-orm";
import type { DiarySubjectType } from "#shared/diary";
import type { DiaryEntryInput, DiaryQuery } from "#shared/schemas/diary";
import { db } from "~~/server/database/client";
import { diaryEntry } from "~~/server/database/schema";

export type DiaryEntryRow = typeof diaryEntry.$inferSelect;

export const DEFAULT_DIARY_LIMIT = 100;

export interface AutoEvent {
  subjectType: DiarySubjectType;
  subjectId: number | null;
  eventType: string;
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

export function latestAutoEvent(
  subjectType: DiarySubjectType,
  subjectId: number,
  eventType: string,
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
