import { and, asc, desc, eq, gte, inArray, isNull, or } from "drizzle-orm";
import type { DeviceStatus } from "#shared/smart/status";
import { db } from "~~/server/database/client";
import {
  diaryEntry,
  disk,
  host,
  pool,
  poolHistory,
  poolReading,
  vdev,
  zfsEvent,
} from "~~/server/database/schema";
import type { DiaryEntryRow } from "~~/server/services/diary";
import { notFound } from "~~/server/utils/serviceError";
import type { PoolRow, VdevRow } from "./topology";

const DAY_MS = 24 * 60 * 60 * 1000;
export const POOL_READING_DAYS = 30;
export const POOL_DETAIL_LIMIT = 50;
export const POOL_DIARY_LIMIT = 100;

export interface VdevDisk {
  id: number;
  alias: string | null;
  state: string | null;
  latestStatus: DeviceStatus;
}

export interface VdevNode extends Omit<VdevRow, "poolId" | "diskId"> {
  disk: VdevDisk | null;
  children: VdevNode[];
}

export interface PoolHost {
  id: number;
  name: string;
  displayName: string | null;
}

export interface PoolSummary extends Omit<PoolRow, "hostId"> {
  host: PoolHost;
  vdevs: VdevNode | null;
}

export type PoolReadingRow = typeof poolReading.$inferSelect;
export type PoolHistoryRow = typeof poolHistory.$inferSelect;
export type ZfsEventRow = typeof zfsEvent.$inferSelect;

export interface PoolDetail extends PoolSummary {
  readings: PoolReadingRow[];
  diary: DiaryEntryRow[];
  history: PoolHistoryRow[];
  historyScope: "pool" | "host";
  events: ZfsEventRow[];
}

const byName = new Intl.Collator("en-GB", { numeric: true }).compare;

function vdevDisks(diskIds: number[]) {
  if (diskIds.length === 0) return new Map<number, VdevDisk>();
  const rows = db
    .select({
      id: disk.id,
      alias: disk.alias,
      state: disk.lastState,
      latestStatus: disk.latestStatus,
    })
    .from(disk)
    .where(inArray(disk.id, diskIds))
    .all();
  return new Map(rows.map((row) => [row.id, row]));
}

function vdevTrees(poolIds: number[]): Map<number, VdevNode | null> {
  const rows =
    poolIds.length === 0
      ? []
      : db
          .select()
          .from(vdev)
          .where(and(inArray(vdev.poolId, poolIds), eq(vdev.present, true)))
          .all();
  const disks = vdevDisks(
    rows.flatMap((row) => (row.diskId === null ? [] : [row.diskId])),
  );
  const nodes = new Map<number, VdevNode & { poolId: number }>();
  for (const { diskId, ...row } of rows) {
    nodes.set(row.id, {
      ...row,
      disk: diskId === null ? null : (disks.get(diskId) ?? null),
      children: [],
    });
  }
  const roots = new Map<number, VdevNode | null>(
    poolIds.map((id) => [id, null]),
  );
  for (const node of nodes.values()) {
    const parent =
      node.parentId === null ? undefined : nodes.get(node.parentId);
    if (parent) parent.children.push(node);
    else if (node.type === "root") roots.set(node.poolId, node);
  }
  for (const node of nodes.values()) {
    node.children.sort((a, b) => byName(a.name, b.name));
  }
  for (const [poolId, root] of roots) {
    if (root) roots.set(poolId, withoutPoolId(root));
  }
  return roots;
}

function withoutPoolId(node: VdevNode & { poolId?: number }): VdevNode {
  const { poolId: _poolId, children, ...rest } = node;
  return { ...rest, children: children.map(withoutPoolId) };
}

function summarise(rows: { pool: PoolRow; host: PoolHost }[]): PoolSummary[] {
  const trees = vdevTrees(rows.map((row) => row.pool.id));
  return rows.map(({ pool: poolRow, host: hostRow }) => {
    const { hostId: _hostId, ...columns } = poolRow;
    return {
      ...columns,
      host: hostRow,
      vdevs: trees.get(poolRow.id) ?? null,
    };
  });
}

function selectPools() {
  return db
    .select({
      pool,
      host: { id: host.id, name: host.name, displayName: host.displayName },
    })
    .from(pool)
    .innerJoin(host, eq(host.id, pool.hostId));
}

export function listPools(): PoolSummary[] {
  return summarise(selectPools().orderBy(asc(host.name), asc(pool.name)).all());
}

function recentReadings(poolId: number, now: Date) {
  return db
    .select()
    .from(poolReading)
    .where(
      and(
        eq(poolReading.poolId, poolId),
        gte(
          poolReading.at,
          new Date(now.getTime() - POOL_READING_DAYS * DAY_MS),
        ),
      ),
    )
    .orderBy(asc(poolReading.at), asc(poolReading.id))
    .all();
}

function poolDiary(poolId: number) {
  const vdevIds = db
    .select({ id: vdev.id })
    .from(vdev)
    .where(eq(vdev.poolId, poolId))
    .all()
    .map((row) => row.id);
  const poolEntries = and(
    eq(diaryEntry.subjectType, "pool"),
    eq(diaryEntry.subjectId, poolId),
  );
  const vdevEntries =
    vdevIds.length === 0
      ? undefined
      : and(
          eq(diaryEntry.subjectType, "vdev"),
          inArray(diaryEntry.subjectId, vdevIds),
        );
  return db
    .select()
    .from(diaryEntry)
    .where(vdevEntries ? or(poolEntries, vdevEntries) : poolEntries)
    .orderBy(desc(diaryEntry.at), desc(diaryEntry.id))
    .limit(POOL_DIARY_LIMIT)
    .all();
}

function historyFor(poolRow: PoolRow) {
  const recent = (scope: ReturnType<typeof and>) =>
    db
      .select()
      .from(poolHistory)
      .where(scope)
      .orderBy(desc(poolHistory.at), desc(poolHistory.id))
      .limit(POOL_DETAIL_LIMIT)
      .all();
  const ofPool = recent(eq(poolHistory.poolId, poolRow.id));
  if (ofPool.length > 0)
    return { history: ofPool, historyScope: "pool" as const };
  return {
    history: recent(
      and(eq(poolHistory.hostId, poolRow.hostId), isNull(poolHistory.poolId)),
    ),
    historyScope: "host" as const,
  };
}

function recentEvents(poolGuid: string) {
  return db
    .select()
    .from(zfsEvent)
    .where(eq(zfsEvent.poolGuid, poolGuid))
    .orderBy(desc(zfsEvent.at), desc(zfsEvent.id))
    .limit(POOL_DETAIL_LIMIT)
    .all();
}

export function getPool(id: number, now = new Date()): PoolDetail {
  const row = selectPools().where(eq(pool.id, id)).get();
  if (!row) throw notFound(`Pool ${id} not found`);
  const [summary] = summarise([row]);
  if (!summary) throw notFound(`Pool ${id} not found`);
  return {
    ...summary,
    readings: recentReadings(id, now),
    diary: poolDiary(id),
    ...historyFor(row.pool),
    events: recentEvents(row.pool.guid),
  };
}
