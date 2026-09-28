import {
  and,
  asc,
  count,
  desc,
  eq,
  getTableColumns,
  gte,
  inArray,
  lt,
  type SQL,
  sql,
} from "drizzle-orm";
import type { SQLiteTable } from "drizzle-orm/sqlite-core";
import { db } from "~~/server/database/client";
import {
  dataset,
  datasetReading,
  host,
  pool,
  snapshot,
} from "~~/server/database/schema";
import type {
  ZfsDataset,
  ZfsListResult,
  ZfsProperty,
} from "~~/server/ingest/zfs-list";
import type {
  ZfsSnapshot,
  ZfsSnapshotsResult,
} from "~~/server/ingest/zfs-snapshots";
import {
  addAutoEvent,
  type DiaryEntryRow,
  listDiary,
} from "~~/server/services/diary";
import { notFound } from "~~/server/utils/serviceError";
import type { PoolRow } from "./topology";

export type DatasetRow = typeof dataset.$inferSelect;
export type DatasetReadingRow = typeof datasetReading.$inferSelect;
export type SnapshotRow = typeof snapshot.$inferSelect;

export interface DatasetIngestSummary {
  created: number;
  destroyed: number;
  skipped: number;
}

const UPSERT_CHUNK_SIZE = 500;
const READING_RETENTION_MS = 400 * 24 * 60 * 60 * 1000;
const READING_CHANGE_THRESHOLD = 0.01;

function chunked<T>(items: T[], size = UPSERT_CHUNK_SIZE): T[][] {
  const chunks: T[][] = [];
  for (let start = 0; start < items.length; start += size) {
    chunks.push(items.slice(start, start + size));
  }
  return chunks;
}

function excludedColumns<T extends SQLiteTable>(
  table: T,
  keys: (keyof T["$inferInsert"] & string)[],
): Record<string, SQL> {
  const columns = getTableColumns(table);
  return Object.fromEntries(
    keys.map((key) => [key, sql.raw(`excluded."${columns[key].name}"`)]),
  );
}

function numberProperty(property: ZfsProperty | undefined): number | null {
  if (property === undefined) return null;
  const value =
    typeof property.value === "number"
      ? property.value
      : Number.parseFloat(property.value);
  return Number.isFinite(value) ? value : null;
}

function unsetWhenZero(property: ZfsProperty | undefined): number | null {
  const value = numberProperty(property);
  return value === 0 ? null : value;
}

function textProperty(property: ZfsProperty | undefined): string | null {
  if (property === undefined || property.value === "-") return null;
  return String(property.value);
}

function secondsToDate(seconds: number) {
  return new Date(seconds * 1000);
}

function datasetFields({ type, properties }: ZfsDataset) {
  const creation = numberProperty(properties.creation) ?? 0;
  return {
    type,
    mountpoint: textProperty(properties.mountpoint),
    used: numberProperty(properties.used) ?? 0,
    referenced: numberProperty(properties.referenced) ?? 0,
    available: numberProperty(properties.available) ?? 0,
    logicalUsed: numberProperty(properties.logicalused),
    compressRatio: numberProperty(properties.compressratio),
    usedBySnapshots: numberProperty(properties.usedbysnapshots),
    usedByDataset: numberProperty(properties.usedbydataset),
    usedByChildren: numberProperty(properties.usedbychildren),
    quota: unsetWhenZero(properties.quota),
    refQuota: unsetWhenZero(properties.refquota),
    reservation: unsetWhenZero(properties.reservation),
    recordSize: numberProperty(properties.recordsize),
    compression: textProperty(properties.compression),
    encryption: textProperty(properties.encryption),
    creation: secondsToDate(creation),
  };
}

type DatasetFields = ReturnType<typeof datasetFields>;

const DATASET_UPDATE_SET = excludedColumns(dataset, [
  "type",
  "mountpoint",
  "used",
  "referenced",
  "available",
  "logicalUsed",
  "compressRatio",
  "usedBySnapshots",
  "usedByDataset",
  "usedByChildren",
  "quota",
  "refQuota",
  "reservation",
  "recordSize",
  "compression",
  "encryption",
  "creation",
  "present",
  "lastSeenAt",
] satisfies (keyof DatasetFields | "present" | "lastSeenAt")[]);

function parentName(name: string): string | null {
  const slash = name.lastIndexOf("/");
  return slash === -1 ? null : name.slice(0, slash);
}

function hostPools(hostId: number): PoolRow[] {
  return db.select().from(pool).where(eq(pool.hostId, hostId)).all();
}

function upsertDatasets(
  poolRow: PoolRow,
  observed: ZfsDataset[],
  receivedAt: Date,
) {
  const values = observed.map((observedDataset) => ({
    ...datasetFields(observedDataset),
    poolId: poolRow.id,
    name: observedDataset.name,
    present: true,
    firstSeenAt: receivedAt,
    lastSeenAt: receivedAt,
  }));
  for (const chunk of chunked(values)) {
    db.insert(dataset)
      .values(chunk)
      .onConflictDoUpdate({
        target: [dataset.poolId, dataset.name],
        set: DATASET_UPDATE_SET,
      })
      .run();
  }
}

function resolveParents(poolRow: PoolRow) {
  const rows = db
    .select({ id: dataset.id, name: dataset.name, parentId: dataset.parentId })
    .from(dataset)
    .where(eq(dataset.poolId, poolRow.id))
    .all();
  const idByName = new Map(rows.map((row) => [row.name, row.id]));
  for (const row of rows) {
    const parent = parentName(row.name);
    const parentId = parent === null ? null : (idByName.get(parent) ?? null);
    if (parentId === row.parentId) continue;
    db.update(dataset).set({ parentId }).where(eq(dataset.id, row.id)).run();
  }
}

function recordDatasetEvent(
  poolRow: PoolRow,
  row: Pick<DatasetRow, "id" | "name">,
  change: "created" | "destroyed",
  receivedAt: Date,
) {
  addAutoEvent({
    subjectType: "pool",
    subjectId: poolRow.id,
    eventType: `dataset-${change}`,
    title: `dataset ${row.name} ${change}`,
    data: { datasetId: row.id },
    at: receivedAt,
  });
}

function utcDay(date: Date) {
  return date.toISOString().slice(0, 10);
}

function readingDue(
  latest: Pick<DatasetReadingRow, "at" | "used"> | undefined,
  used: number,
  receivedAt: Date,
) {
  if (!latest) return true;
  if (utcDay(latest.at) !== utcDay(receivedAt)) return true;
  return Math.abs(used - latest.used) > latest.used * READING_CHANGE_THRESHOLD;
}

function recordReadings(poolRow: PoolRow, receivedAt: Date) {
  const rows = db
    .select()
    .from(dataset)
    .where(and(eq(dataset.poolId, poolRow.id), eq(dataset.present, true)))
    .all();
  if (rows.length === 0) return;
  const datasetIds = rows.map((row) => row.id);
  const latestIds = db
    .select({ id: sql<number>`max(${datasetReading.id})` })
    .from(datasetReading)
    .where(inArray(datasetReading.datasetId, datasetIds))
    .groupBy(datasetReading.datasetId);
  const latestByDataset = new Map(
    db
      .select()
      .from(datasetReading)
      .where(inArray(datasetReading.id, latestIds))
      .all()
      .map((reading) => [reading.datasetId, reading]),
  );
  const due = rows
    .filter((row) =>
      readingDue(latestByDataset.get(row.id), row.used, receivedAt),
    )
    .map((row) => ({
      datasetId: row.id,
      at: receivedAt,
      used: row.used,
      referenced: row.referenced,
      available: row.available,
      usedBySnapshots: row.usedBySnapshots,
    }));
  for (const chunk of chunked(due)) {
    db.insert(datasetReading).values(chunk).run();
  }
  db.delete(datasetReading)
    .where(
      and(
        inArray(datasetReading.datasetId, datasetIds),
        lt(
          datasetReading.at,
          new Date(receivedAt.getTime() - READING_RETENTION_MS),
        ),
      ),
    )
    .run();
}

function observePoolDatasets(
  poolRow: PoolRow,
  observed: ZfsDataset[],
  receivedAt: Date,
) {
  const existing = db
    .select({ id: dataset.id, name: dataset.name, present: dataset.present })
    .from(dataset)
    .where(eq(dataset.poolId, poolRow.id))
    .all();
  const firstIngest = existing.length === 0;
  const presentBefore = new Set(
    existing.filter((row) => row.present).map((row) => row.name),
  );
  const observedNames = new Set(observed.map((entry) => entry.name));

  upsertDatasets(poolRow, observed, receivedAt);
  resolveParents(poolRow);

  const departed = existing.filter(
    (row) => row.present && !observedNames.has(row.name),
  );
  for (const row of departed) {
    db.update(dataset)
      .set({ present: false })
      .where(eq(dataset.id, row.id))
      .run();
    recordDatasetEvent(poolRow, row, "destroyed", receivedAt);
  }

  const arrived = observed.filter((entry) => !presentBefore.has(entry.name));
  if (!firstIngest && arrived.length > 0) {
    const arrivedNames = new Set(arrived.map((entry) => entry.name));
    const arrivedRows = db
      .select({ id: dataset.id, name: dataset.name })
      .from(dataset)
      .where(eq(dataset.poolId, poolRow.id))
      .all()
      .filter((row) => arrivedNames.has(row.name));
    for (const row of arrivedRows) {
      recordDatasetEvent(poolRow, row, "created", receivedAt);
    }
  }

  recordReadings(poolRow, receivedAt);
  return {
    created: firstIngest ? 0 : arrived.length,
    destroyed: departed.length,
  };
}

function newestPoolByName(pools: PoolRow[]) {
  const byName = new Map<string, PoolRow>();
  for (const row of pools) {
    const current = byName.get(row.name);
    if (!current || row.lastSeenAt > current.lastSeenAt) {
      byName.set(row.name, row);
    }
  }
  return byName;
}

export function observeZfsList(
  hostId: number,
  { datasets }: ZfsListResult,
  receivedAt: Date,
): DatasetIngestSummary {
  return db.transaction(() => {
    const poolsByName = newestPoolByName(hostPools(hostId));
    const observedByPool = new Map<PoolRow, ZfsDataset[]>();
    let skipped = 0;
    for (const observed of datasets) {
      const poolRow = poolsByName.get(observed.pool);
      if (!poolRow) {
        skipped++;
        continue;
      }
      const group = observedByPool.get(poolRow) ?? [];
      group.push(observed);
      observedByPool.set(poolRow, group);
    }

    const summary: DatasetIngestSummary = { created: 0, destroyed: 0, skipped };
    for (const [poolRow, observed] of observedByPool) {
      const { created, destroyed } = observePoolDatasets(
        poolRow,
        observed,
        receivedAt,
      );
      summary.created += created;
      summary.destroyed += destroyed;
    }
    return summary;
  });
}

function hostDatasetIdsByName(pools: PoolRow[]) {
  if (pools.length === 0) return new Map<string, number>();
  const rows = db
    .select({ id: dataset.id, name: dataset.name, present: dataset.present })
    .from(dataset)
    .where(
      inArray(
        dataset.poolId,
        pools.map((row) => row.id),
      ),
    )
    .orderBy(dataset.present, dataset.id)
    .all();
  return new Map(rows.map((row) => [row.name, row.id]));
}

function snapshotKey(datasetId: number, name: string) {
  return `${datasetId}@${name}`;
}

function snapshotValues(
  observed: ZfsSnapshot,
  datasetId: number,
  receivedAt: Date,
) {
  return {
    datasetId,
    name: observed.snapshot,
    guid: observed.guid,
    used: observed.used,
    referenced: observed.referenced,
    written: observed.written,
    creation: secondsToDate(observed.creation),
    lastSeenAt: receivedAt,
  };
}

const SNAPSHOT_UPDATE_SET = {
  ...excludedColumns(snapshot, [
    "used",
    "referenced",
    "written",
    "creation",
    "lastSeenAt",
  ]),
  guid: sql`coalesce(excluded."guid", "Snapshot"."guid")`,
};

function refreshSnapshotCounts(datasetIds: number[]) {
  for (const chunk of chunked(datasetIds)) {
    db.update(dataset)
      .set({
        snapshotCount: sql`(select count(*) from "Snapshot" where "Snapshot"."datasetId" = "Dataset"."id")`,
        latestSnapshotAt: sql`(select max("Snapshot"."creation") from "Snapshot" where "Snapshot"."datasetId" = "Dataset"."id")`,
      })
      .where(inArray(dataset.id, chunk))
      .run();
  }
}

export function observeZfsSnapshots(
  hostId: number,
  { snapshots }: ZfsSnapshotsResult,
  receivedAt: Date,
): DatasetIngestSummary {
  return db.transaction(() => {
    const datasetIdByName = hostDatasetIdsByName(hostPools(hostId));
    const datasetIds = [...new Set(datasetIdByName.values())];

    const values: ReturnType<typeof snapshotValues>[] = [];
    let skipped = 0;
    for (const observed of snapshots) {
      const datasetId = datasetIdByName.get(observed.dataset);
      if (datasetId === undefined) {
        skipped++;
        continue;
      }
      values.push(snapshotValues(observed, datasetId, receivedAt));
    }

    const existing = chunked(datasetIds).flatMap((chunk) =>
      db
        .select({
          id: snapshot.id,
          datasetId: snapshot.datasetId,
          name: snapshot.name,
        })
        .from(snapshot)
        .where(inArray(snapshot.datasetId, chunk))
        .all(),
    );
    const existingKeys = new Set(
      existing.map((row) => snapshotKey(row.datasetId, row.name)),
    );
    const observedKeys = new Set(
      values.map((row) => snapshotKey(row.datasetId, row.name)),
    );

    for (const chunk of chunked(values)) {
      db.insert(snapshot)
        .values(chunk)
        .onConflictDoUpdate({
          target: [snapshot.datasetId, snapshot.name],
          set: SNAPSHOT_UPDATE_SET,
        })
        .run();
    }

    const destroyedIds = existing
      .filter((row) => !observedKeys.has(snapshotKey(row.datasetId, row.name)))
      .map((row) => row.id);
    for (const chunk of chunked(destroyedIds)) {
      db.delete(snapshot).where(inArray(snapshot.id, chunk)).run();
    }

    refreshSnapshotCounts(datasetIds);

    return {
      created: [...observedKeys].filter((key) => !existingKeys.has(key)).length,
      destroyed: destroyedIds.length,
      skipped,
    };
  });
}

const DAY_MS = 24 * 60 * 60 * 1000;
export const DATASET_READING_DAYS = 90;
export const DATASET_SEARCH_LIMIT = 20;

export interface DatasetSummary extends DatasetRow {
  depth: number;
}

export interface DatasetHost {
  id: number;
  name: string;
  displayName: string | null;
}

export interface DatasetChild {
  id: number;
  name: string;
  used: number;
  present: boolean;
}

export interface DatasetSnapshot extends SnapshotRow {
  ageMs: number;
}

export interface DatasetDetail extends DatasetSummary {
  pool: { id: number; name: string; guid: string };
  host: DatasetHost;
  children: DatasetChild[];
  snapshots: DatasetSnapshot[];
  readings: DatasetReadingRow[];
  diary: DiaryEntryRow[];
}

export interface DatasetCounts {
  datasets: number;
  snapshots: number;
  latestSnapshotAt: Date | null;
}

export interface DatasetSearchResult {
  id: number;
  name: string;
  pool: { id: number; name: string };
  host: DatasetHost;
}

function depthOf(name: string) {
  return name.split("/").length - 1;
}

function compareDatasetPaths(a: string, b: string) {
  const left = a.split("/");
  const right = b.split("/");
  for (let index = 0; index < Math.min(left.length, right.length); index++) {
    if (left[index] !== right[index]) {
      return left[index] < right[index] ? -1 : 1;
    }
  }
  return left.length - right.length;
}

export function listDatasets(poolId: number): DatasetSummary[] {
  const poolRow = db
    .select({ id: pool.id })
    .from(pool)
    .where(eq(pool.id, poolId))
    .get();
  if (!poolRow) throw notFound(`Pool ${poolId} not found`);
  return db
    .select()
    .from(dataset)
    .where(eq(dataset.poolId, poolId))
    .all()
    .sort(
      (a, b) =>
        Number(b.present) - Number(a.present) ||
        compareDatasetPaths(a.name, b.name),
    )
    .map((row) => ({ ...row, depth: depthOf(row.name) }));
}

function datasetChildren(id: number): DatasetChild[] {
  return db
    .select({
      id: dataset.id,
      name: dataset.name,
      used: dataset.used,
      present: dataset.present,
    })
    .from(dataset)
    .where(eq(dataset.parentId, id))
    .all()
    .sort(
      (a, b) =>
        Number(b.present) - Number(a.present) ||
        compareDatasetPaths(a.name, b.name),
    );
}

function datasetSnapshots(id: number, now: Date): DatasetSnapshot[] {
  return db
    .select()
    .from(snapshot)
    .where(eq(snapshot.datasetId, id))
    .orderBy(desc(snapshot.creation), desc(snapshot.id))
    .all()
    .map((row) => ({ ...row, ageMs: now.getTime() - row.creation.getTime() }));
}

function recentDatasetReadings(id: number, now: Date) {
  return db
    .select()
    .from(datasetReading)
    .where(
      and(
        eq(datasetReading.datasetId, id),
        gte(
          datasetReading.at,
          new Date(now.getTime() - DATASET_READING_DAYS * DAY_MS),
        ),
      ),
    )
    .orderBy(asc(datasetReading.at), asc(datasetReading.id))
    .all();
}

export function getDataset(id: number, now = new Date()): DatasetDetail {
  const row = db
    .select({
      dataset,
      pool: { id: pool.id, name: pool.name, guid: pool.guid },
      host: { id: host.id, name: host.name, displayName: host.displayName },
    })
    .from(dataset)
    .innerJoin(pool, eq(pool.id, dataset.poolId))
    .innerJoin(host, eq(host.id, pool.hostId))
    .where(eq(dataset.id, id))
    .get();
  if (!row) throw notFound(`Dataset ${id} not found`);
  return {
    ...row.dataset,
    depth: depthOf(row.dataset.name),
    pool: row.pool,
    host: row.host,
    children: datasetChildren(id),
    snapshots: datasetSnapshots(id, now),
    readings: recentDatasetReadings(id, now),
    diary: listDiary({ subjectType: "dataset", subjectId: id }),
  };
}

const EMPTY_COUNTS: DatasetCounts = {
  datasets: 0,
  snapshots: 0,
  latestSnapshotAt: null,
};

export function datasetCountsByPool(
  poolIds: number[],
): Map<number, DatasetCounts> {
  const counts = new Map<number, DatasetCounts>(
    poolIds.map((id) => [id, { ...EMPTY_COUNTS }]),
  );
  if (poolIds.length === 0) return counts;
  const rows = db
    .select({
      poolId: dataset.poolId,
      datasets: count(),
      snapshots:
        sql<number>`coalesce(sum(${dataset.snapshotCount}), 0)`.mapWith(Number),
      latestSnapshotAt:
        sql<Date | null>`max(${dataset.latestSnapshotAt})`.mapWith(
          dataset.latestSnapshotAt,
        ),
    })
    .from(dataset)
    .where(and(inArray(dataset.poolId, poolIds), eq(dataset.present, true)))
    .groupBy(dataset.poolId)
    .all();
  for (const { poolId, ...row } of rows) counts.set(poolId, row);
  return counts;
}

export function datasetCounts(poolId: number): DatasetCounts {
  return datasetCountsByPool([poolId]).get(poolId) ?? { ...EMPTY_COUNTS };
}

function likePattern(query: string) {
  return `%${query.replace(/[\\%_]/g, (match) => `\\${match}`)}%`;
}

function datasetSummaries() {
  return db
    .select({
      id: dataset.id,
      name: dataset.name,
      pool: { id: pool.id, name: pool.name },
      host: { id: host.id, name: host.name, displayName: host.displayName },
    })
    .from(dataset)
    .innerJoin(pool, eq(pool.id, dataset.poolId))
    .innerJoin(host, eq(host.id, pool.hostId));
}

export function lookupDatasets(ids: number[]): DatasetSearchResult[] {
  if (ids.length === 0) return [];
  return datasetSummaries()
    .where(inArray(dataset.id, ids))
    .orderBy(asc(dataset.name), asc(host.name))
    .all();
}

export function searchDatasets(
  query: string,
  limit = DATASET_SEARCH_LIMIT,
): DatasetSearchResult[] {
  return datasetSummaries()
    .where(
      and(
        eq(dataset.present, true),
        sql`${dataset.name} like ${likePattern(query)} escape '\\'`,
      ),
    )
    .orderBy(asc(dataset.name), asc(host.name))
    .limit(limit)
    .all();
}
