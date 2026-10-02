import {
  and,
  asc,
  desc,
  eq,
  gte,
  inArray,
  isNotNull,
  isNull,
  or,
} from "drizzle-orm";
import type { Media } from "#shared/hardware";
import { resolveModelShort } from "#shared/model";
import {
  type PoolArchivedFilter,
  type PoolConfig,
  type ResolvedPoolConfig,
  resolvePoolConfig,
} from "#shared/schemas/pools";
import type { DeviceStatus } from "#shared/smart/status";
import {
  type HostTemperatureThresholds,
  resolveTemperatureThresholds,
  type TemperatureThresholds,
} from "#shared/temperature";
import type { Purpose } from "#shared/usage";
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
import { resolvePurpose } from "~~/server/services/usage";
import { notFound } from "~~/server/utils/serviceError";
import { datasetCountsByPool } from "./datasets";
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
  capacityBytes: number | null;
  media: Media | null;
  purpose: Purpose | null;
  latestTemp: number | null;
  modelShort: string | null;
  tempThresholds: TemperatureThresholds;
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
  resolvedConfig: ResolvedPoolConfig;
  vdevs: VdevNode | null;
  datasetCount: number;
  snapshotCount: number;
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

type ThresholdHost = {
  temperatureThresholds: HostTemperatureThresholds | null;
};

function vdevDiskRows(diskIds: number[]) {
  if (diskIds.length === 0) return [];
  return db
    .select({
      id: disk.id,
      alias: disk.alias,
      state: disk.lastState,
      latestStatus: disk.latestStatus,
      capacityBytes: disk.capacityBytes,
      media: disk.media,
      latestTemp: disk.latestTemp,
      model: disk.model,
      specs: disk.specs,
      inventory: disk.inventory,
      latestUsage: disk.latestUsage,
    })
    .from(disk)
    .where(inArray(disk.id, diskIds))
    .all();
}

type VdevDiskRow = ReturnType<typeof vdevDiskRows>[number];

function toVdevDisk(
  { model, specs, inventory, latestUsage, ...columns }: VdevDiskRow,
  poolHost: ThresholdHost | null,
): VdevDisk {
  return {
    ...columns,
    purpose: resolvePurpose(inventory, latestUsage).purpose,
    modelShort: resolveModelShort(inventory, specs, model),
    tempThresholds: resolveTemperatureThresholds(poolHost, columns.media),
  };
}

function poolThresholdHosts(poolIds: number[]): Map<number, ThresholdHost> {
  const rows = db
    .select({
      poolId: pool.id,
      temperatureThresholds: host.temperatureThresholds,
    })
    .from(pool)
    .innerJoin(host, eq(host.id, pool.hostId))
    .where(inArray(pool.id, poolIds))
    .all();
  return new Map(rows.map(({ poolId, ...poolHost }) => [poolId, poolHost]));
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
  const diskRows = new Map(
    vdevDiskRows(
      rows.flatMap((row) => (row.diskId === null ? [] : [row.diskId])),
    ).map((row) => [row.id, row]),
  );
  const poolHosts = poolThresholdHosts(poolIds);
  const vdevDisk = (diskId: number | null, poolId: number) => {
    const diskRow = diskId === null ? undefined : diskRows.get(diskId);
    return diskRow ? toVdevDisk(diskRow, poolHosts.get(poolId) ?? null) : null;
  };
  const nodes = new Map<number, VdevNode & { poolId: number }>();
  for (const { diskId, ...row } of rows) {
    nodes.set(row.id, {
      ...row,
      disk: vdevDisk(diskId, row.poolId),
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
  const poolIds = rows.map((row) => row.pool.id);
  const trees = vdevTrees(poolIds);
  const counts = datasetCountsByPool(poolIds);
  return rows.map(({ pool: poolRow, host: hostRow }) => {
    const { hostId: _hostId, ...columns } = poolRow;
    const poolCounts = counts.get(poolRow.id);
    return {
      ...columns,
      host: hostRow,
      resolvedConfig: resolvePoolConfig(poolRow.config),
      vdevs: trees.get(poolRow.id) ?? null,
      datasetCount: poolCounts?.datasets ?? 0,
      snapshotCount: poolCounts?.snapshots ?? 0,
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

const ARCHIVED_CONDITIONS = {
  exclude: isNull(pool.archivedAt),
  include: undefined,
  only: isNotNull(pool.archivedAt),
} satisfies Record<PoolArchivedFilter, unknown>;

export function listPools(
  archived: PoolArchivedFilter = "exclude",
): PoolSummary[] {
  return summarise(
    selectPools()
      .where(ARCHIVED_CONDITIONS[archived])
      .orderBy(asc(host.name), asc(pool.name))
      .all(),
  );
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

export function updatePoolConfig(id: number, patch: PoolConfig): PoolDetail {
  const row = db.select().from(pool).where(eq(pool.id, id)).get();
  if (!row) throw notFound(`Pool ${id} not found`);
  db.update(pool)
    .set({ config: { ...row.config, ...patch } })
    .where(eq(pool.id, id))
    .run();
  return getPool(id);
}
