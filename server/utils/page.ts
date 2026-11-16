import { and, eq, lt, or, type SQL } from "drizzle-orm";
import type { SQLiteColumn } from "drizzle-orm/sqlite-core";
import type { PageCursor } from "#shared/schemas/page";

export interface Page<T> {
  items: T[];
  hasMore: boolean;
}

export interface CountedPage<T> extends Page<T> {
  total: number;
}

/** Rows strictly after the cursor in newest-first (`at`, `id`) order. */
export function olderThan(
  at: SQLiteColumn,
  id: SQLiteColumn,
  { beforeAt, beforeId }: PageCursor,
): SQL | undefined {
  if (beforeAt === undefined || beforeId === undefined) return undefined;
  const before = new Date(beforeAt);
  return or(lt(at, before), and(eq(at, before), lt(id, beforeId)));
}

/** `rows` were fetched with `limit + 1` so the extra row says whether more remain. */
export function pageOf<T>(rows: T[], limit: number): Page<T> {
  return { items: rows.slice(0, limit), hasMore: rows.length > limit };
}
