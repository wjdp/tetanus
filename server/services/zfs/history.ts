import { and, asc, desc, eq, gt, isNull, notLike, sql } from "drizzle-orm";
import { ROUTINE_HISTORY_DAYS } from "#shared/retention";
import type { PoolHistoryQuery } from "#shared/schemas/pools";
import { db } from "~~/server/database/client";
import { pool, poolHistory } from "~~/server/database/schema";
import type {
  ZpoolHistoryEntry,
  ZpoolHistoryResult,
} from "~~/server/ingest/zpool-history";
import { RECEIVE_WINDOW_MS } from "~~/server/services/replications/population";
import {
  ensureSettings,
  setRoutineHistoryVersion,
} from "~~/server/services/settings";
import { olderThan, type Page, pageOf } from "~~/server/utils/page";
import { notFound } from "~~/server/utils/serviceError";

const DAY_MS = 24 * 60 * 60 * 1000;
const RECLASSIFY_BATCH_SIZE = 5000;
const IOCTL_RECORD_LIKE = "(%ms) ioctl %";

const ROUTINE_COMMAND_RES = [
  /^zfs (?:(?:snapshot|receive|recv|send|hold|release) |destroy (?:-\S+ )*\S*@)/,
  /^\(\d+ms\) ioctl (?:snapshot|destroy_snaps|receive|recv|send\w*|hold|release)\b/,
  /^zfs rollback (?:-\S+ )*\S+@syncoid_/,
  /^\(\d+ms\) ioctl rollback\n\s+input:\n\s+target: '[^'@]+@syncoid_/,
];
const ROUTINE_INTERNAL_RE =
  /^(?:(?:snapshot|hold|release|receive|finish receiving|clone swap) |destroy \S*(?:@|\/%recv |\/%rollback ))/;

/** Bump when {@link isRoutineHistory} changes, so stored rows are reclassified. */
export const ROUTINE_HISTORY_VERSION = 1;

/**
 * Snapshot, replication and hold churn: kept for a while, not forever. syncoid rolls
 * its target back to the newest common snapshot on every run, so those rollbacks are
 * churn too; any other rollback is a deliberate act.
 */
export function isRoutineHistory({
  internal,
  text,
}: Pick<ZpoolHistoryEntry, "internal" | "text">) {
  if (internal) return ROUTINE_INTERNAL_RE.test(text);
  return ROUTINE_COMMAND_RES.some((pattern) => pattern.test(text));
}

export function routineHistoryCutoff(now: Date) {
  return new Date(now.getTime() - ROUTINE_HISTORY_DAYS * DAY_MS);
}

/**
 * The collector resends weeks of receive lines every run. Routine lines older than
 * the retention cutoff, less the receive derivation window, are dropped on arrival
 * so pruned lines do not return and derivation only reads lines still kept.
 */
export function retainedHistoryEntries<
  T extends Pick<ZpoolHistoryEntry, "at" | "internal" | "text">,
>(entries: T[], receivedAt: Date): T[] {
  const cutoff = routineHistoryCutoff(receivedAt).getTime() + RECEIVE_WINDOW_MS;
  return entries.filter(
    (entry) => Date.parse(entry.at) >= cutoff || !isRoutineHistory(entry),
  );
}

export function observeZpoolHistory(
  hostId: number,
  { entries }: ZpoolHistoryResult,
) {
  const poolIdByName = new Map(
    db
      .select({ id: pool.id, name: pool.name })
      .from(pool)
      .where(eq(pool.hostId, hostId))
      .all()
      .map((row) => [row.name, row.id]),
  );
  for (const entry of entries) {
    const poolId =
      entry.pool === null ? null : (poolIdByName.get(entry.pool) ?? null);
    db.insert(poolHistory)
      .values({
        hostId,
        poolId,
        at: new Date(entry.at),
        internal: entry.internal,
        text: entry.text,
        routine: isRoutineHistory(entry),
      })
      .onConflictDoUpdate({
        target: [poolHistory.hostId, poolHistory.at, poolHistory.text],
        set: { poolId: sql`excluded.poolId` },
        setWhere: sql`excluded.poolId is not null and excluded.poolId is not ${poolHistory.poolId}`,
      })
      .run();
  }
}

function reclassifyBatch(after: number) {
  const rows = db
    .select({
      id: poolHistory.id,
      internal: poolHistory.internal,
      text: poolHistory.text,
      routine: poolHistory.routine,
    })
    .from(poolHistory)
    .where(gt(poolHistory.id, after))
    .orderBy(asc(poolHistory.id))
    .limit(RECLASSIFY_BATCH_SIZE)
    .all();
  let changed = 0;
  for (const row of rows) {
    const routine = isRoutineHistory(row);
    if (routine === row.routine) continue;
    db.update(poolHistory)
      .set({ routine })
      .where(eq(poolHistory.id, row.id))
      .run();
    changed++;
  }
  return {
    changed,
    lastId: rows.at(-1)?.id,
    done: rows.length < RECLASSIFY_BATCH_SIZE,
  };
}

/** Applies the current routine rules to stored lines once per classifier version. */
export function reclassifyRoutineHistoryIfStale(): boolean {
  if (ensureSettings().config.routineHistoryVersion === ROUTINE_HISTORY_VERSION)
    return false;
  const changed = db.transaction(() => {
    let total = 0;
    let after = 0;
    for (;;) {
      const batch = reclassifyBatch(after);
      total += batch.changed;
      if (batch.done || batch.lastId === undefined) break;
      after = batch.lastId;
    }
    setRoutineHistoryVersion(ROUTINE_HISTORY_VERSION);
    return total;
  });
  console.log(
    `Pool history routine rules v${ROUTINE_HISTORY_VERSION} applied: ${changed} lines reclassified`,
  );
  return true;
}

export type PoolHistoryRow = typeof poolHistory.$inferSelect;

export interface PoolHistoryPage extends Page<PoolHistoryRow> {
  /** "host" when the collected history has no pool headers to attribute lines. */
  scope: "pool" | "host";
}

function hasPoolScopedHistory(poolId: number) {
  return (
    db
      .select({ id: poolHistory.id })
      .from(poolHistory)
      .where(eq(poolHistory.poolId, poolId))
      .limit(1)
      .get() !== undefined
  );
}

/**
 * Newest first, a page at a time. By default only the pool's record: routine churn
 * and the `ioctl` copies of each command are left out unless `all` is set.
 */
export function listPoolHistory(
  poolId: number,
  { all, limit, ...cursor }: PoolHistoryQuery,
): PoolHistoryPage {
  const row = db
    .select({ hostId: pool.hostId })
    .from(pool)
    .where(eq(pool.id, poolId))
    .get();
  if (!row) throw notFound(`Pool ${poolId} not found`);
  const scope = hasPoolScopedHistory(poolId) ? "pool" : "host";
  const lines = db
    .select()
    .from(poolHistory)
    .where(
      and(
        scope === "pool"
          ? eq(poolHistory.poolId, poolId)
          : and(eq(poolHistory.hostId, row.hostId), isNull(poolHistory.poolId)),
        all ? undefined : eq(poolHistory.routine, false),
        all ? undefined : notLike(poolHistory.text, IOCTL_RECORD_LIKE),
        olderThan(poolHistory.at, poolHistory.id, cursor),
      ),
    )
    .orderBy(desc(poolHistory.at), desc(poolHistory.id))
    .limit(limit + 1)
    .all();
  return { ...pageOf(lines, limit), scope };
}
