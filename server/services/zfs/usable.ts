import { and, desc, eq, gte, inArray, lte } from "drizzle-orm";
import { groupFor } from "#shared/hostFreshness";
import { db } from "~~/server/database/client";
import { dataset, poolReading } from "~~/server/database/schema";
import { collectorCadences } from "~~/server/utils/demo";
import type { PoolRow } from "./topology";

const DEFAULT_ZFS_CADENCE_MS = 10 * 60 * 1000;

export interface PoolUsable {
  used: number;
  available: number;
  at: Date;
}

function zfsCadenceMs() {
  return (
    collectorCadences().zfs ??
    groupFor("zfs-list")?.cadenceMs ??
    DEFAULT_ZFS_CADENCE_MS
  );
}

/**
 * The root dataset's `used` and `available`: what can actually be written,
 * after parity. Null when the root's last `zfs-list` is more than one `zfs`
 * cadence older than the pool's last `zpool status`, so a failed `zfs-list`
 * shows raw figures rather than stale usable ones.
 */
export function usableByPool(
  pools: Pick<PoolRow, "id" | "name" | "lastSeenAt">[],
): Map<number, PoolUsable> {
  if (pools.length === 0) return new Map();
  const roots = db
    .select({
      poolId: dataset.poolId,
      name: dataset.name,
      used: dataset.used,
      available: dataset.available,
      lastSeenAt: dataset.lastSeenAt,
    })
    .from(dataset)
    .where(
      and(
        inArray(
          dataset.poolId,
          pools.map((row) => row.id),
        ),
        inArray(dataset.name, [...new Set(pools.map((row) => row.name))]),
        eq(dataset.present, true),
      ),
    )
    .all();
  const cadenceMs = zfsCadenceMs();
  const usable = new Map<number, PoolUsable>();
  for (const poolRow of pools) {
    const root = roots.find(
      (row) => row.poolId === poolRow.id && row.name === poolRow.name,
    );
    if (
      root &&
      root.lastSeenAt.getTime() >= poolRow.lastSeenAt.getTime() - cadenceMs
    ) {
      usable.set(poolRow.id, {
        used: root.used,
        available: root.available,
        at: root.lastSeenAt,
      });
    }
  }
  return usable;
}

/** Adds the root dataset's figures to the reading this collector run's `zpool status` wrote. */
export function recordPoolUsable(poolRow: PoolRow, receivedAt: Date) {
  const root = db
    .select({ used: dataset.used, available: dataset.available })
    .from(dataset)
    .where(
      and(
        eq(dataset.poolId, poolRow.id),
        eq(dataset.name, poolRow.name),
        eq(dataset.present, true),
      ),
    )
    .get();
  if (!root) return;
  const reading = db
    .select({ id: poolReading.id })
    .from(poolReading)
    .where(
      and(
        eq(poolReading.poolId, poolRow.id),
        gte(poolReading.at, new Date(receivedAt.getTime() - zfsCadenceMs())),
        lte(poolReading.at, receivedAt),
      ),
    )
    .orderBy(desc(poolReading.at), desc(poolReading.id))
    .get();
  if (!reading) return;
  db.update(poolReading)
    .set({ usedBytes: root.used, availableBytes: root.available })
    .where(eq(poolReading.id, reading.id))
    .run();
}
