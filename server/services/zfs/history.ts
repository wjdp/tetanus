import { eq, sql } from "drizzle-orm";
import { db } from "~~/server/database/client";
import { pool, poolHistory } from "~~/server/database/schema";
import type {
  ZpoolHistoryEntry,
  ZpoolHistoryResult,
} from "~~/server/ingest/zpool-history";
import { RECEIVE_WINDOW_MS } from "~~/server/services/replications/population";

const DAY_MS = 24 * 60 * 60 * 1000;
export const ROUTINE_HISTORY_DAYS = 14;

const ROUTINE_COMMAND_RE =
  /^zfs (?:(?:snapshot|receive|recv|send|hold|release) |destroy (?:-\S+ )*\S*@)/;
const ROUTINE_IOCTL_RE =
  /^\(\d+ms\) ioctl (?:snapshot|destroy_snaps|receive|recv|send\w*|hold|release)\b/;
const ROUTINE_INTERNAL_RE =
  /^(?:(?:snapshot|hold|release|receive|finish receiving|clone swap) |destroy \S*(?:@|\/%recv |\/%rollback ))/;

/** Snapshot, replication and hold churn: kept for a while, not forever. */
export function isRoutineHistory({
  internal,
  text,
}: Pick<ZpoolHistoryEntry, "internal" | "text">) {
  if (internal) return ROUTINE_INTERNAL_RE.test(text);
  return ROUTINE_COMMAND_RE.test(text) || ROUTINE_IOCTL_RE.test(text);
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
      })
      .onConflictDoUpdate({
        target: [poolHistory.hostId, poolHistory.at, poolHistory.text],
        set: { poolId: sql`coalesce(excluded.poolId, ${poolHistory.poolId})` },
      })
      .run();
  }
}
