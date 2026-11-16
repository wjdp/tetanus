import { and, count, desc, eq, type SQL } from "drizzle-orm";
import type {
  DiaryEntryKind,
  DiaryEventType,
  DiarySubjectType,
} from "#shared/diary";
import type {
  DiaryEntryInput,
  DiaryEntryPatch,
  DiaryQuery,
} from "#shared/schemas/diary";
import { db } from "~~/server/database/client";
import { diaryEntry } from "~~/server/database/schema";
import { labelSubjects } from "~~/server/services/subjectLabels";
import {
  type CountedPage,
  countedPageOf,
  olderThan,
} from "~~/server/utils/page";
import { notFound, ServiceError } from "~~/server/utils/serviceError";

export type DiaryEntryRow = typeof diaryEntry.$inferSelect;
export type DiaryEntry = DiaryEntryRow & {
  subjectLabel: string | null;
  subjectPath: string | null;
};

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

interface DiaryFilter {
  subjectType?: DiarySubjectType;
  subjectId?: number;
  kind?: DiaryEntryKind;
}

function diaryFilter({ subjectType, subjectId, kind }: DiaryFilter) {
  const filters: SQL[] = [];
  if (subjectType) filters.push(eq(diaryEntry.subjectType, subjectType));
  if (subjectId !== undefined)
    filters.push(eq(diaryEntry.subjectId, subjectId));
  if (kind) filters.push(eq(diaryEntry.kind, kind));
  return and(...filters);
}

export function listDiary({
  limit = DEFAULT_DIARY_LIMIT,
  ...filter
}: DiaryFilter & { limit?: number } = {}): DiaryEntry[] {
  return labelSubjects(
    db
      .select()
      .from(diaryEntry)
      .where(diaryFilter(filter))
      .orderBy(desc(diaryEntry.at), desc(diaryEntry.id))
      .limit(limit)
      .all(),
  );
}

/** Newest first, a page at a time; `where` scopes both the page and the total. */
export function pageDiary(
  where: SQL | undefined,
  { limit, ...cursor }: Pick<DiaryQuery, "limit" | "beforeAt" | "beforeId">,
): CountedPage<DiaryEntry> {
  const rows = db
    .select()
    .from(diaryEntry)
    .where(and(where, olderThan(diaryEntry.at, diaryEntry.id, cursor)))
    .orderBy(desc(diaryEntry.at), desc(diaryEntry.id))
    .limit(limit + 1)
    .all();
  return countedPageOf(
    labelSubjects(rows),
    limit,
    cursor,
    () =>
      db.select({ total: count() }).from(diaryEntry).where(where).get()
        ?.total ?? 0,
  );
}

export function listDiaryPage({
  subjectType,
  subjectId,
  kind,
  ...page
}: DiaryQuery): CountedPage<DiaryEntry> {
  return pageDiary(diaryFilter({ subjectType, subjectId, kind }), page);
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
