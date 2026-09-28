import { eq, sql } from "drizzle-orm";
import { db } from "~~/server/database/client";
import { pool, poolHistory } from "~~/server/database/schema";
import type { ZpoolHistoryResult } from "~~/server/ingest/zpool-history";

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
