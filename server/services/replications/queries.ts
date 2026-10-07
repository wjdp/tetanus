import { and, count, desc, eq, inArray, max, or } from "drizzle-orm";
import {
  type DatasetReplication,
  INTERVAL_SYNCS,
  learntIntervalMs,
  REPLICATION_LADDER_LIMIT,
  REPLICATION_SYNCS_PAGE,
  type ReplicationEndpoint,
  type ReplicationEndpointFacts,
  type ReplicationHealth,
  type ReplicationLadderRow,
  type ReplicationLadderSnapshot,
  type ReplicationPeer,
  type ReplicationRow,
  type ReplicationSyncView,
  type ReplicationThresholds,
  replicationHealth,
} from "#shared/replications";
import type { SettingsConfig } from "#shared/schemas/settings";
import { DEFAULT_SETTINGS_CONFIG } from "#shared/schemas/settings";
import { db } from "~~/server/database/client";
import {
  collectorRun,
  dataset,
  host,
  pool,
  replication,
  replicationSync,
  snapshot,
} from "~~/server/database/schema";
import { type DiaryEntry, listDiary } from "~~/server/services/diary";
import {
  type PoolPresenceContext,
  poolDisplayState,
  poolPresence,
  poolPresenceContext,
} from "~~/server/services/poolPresence";
import { ensureSettings } from "~~/server/services/settings";
import { poolPaths } from "~~/server/services/zfs/paths";
import { notFound } from "~~/server/utils/serviceError";

type ReplicationTableRow = typeof replication.$inferSelect;

const RECEIVE_SOURCES = ["zfs-receives", "zpool-history"];

export function replicationThresholds(
  config: Pick<
    SettingsConfig,
    | "replicationLateFloorHours"
    | "replicationLateFactor"
    | "replicationStalledFloorHours"
    | "replicationStalledFactor"
  >,
): ReplicationThresholds {
  return {
    lateFloorHours: config.replicationLateFloorHours,
    lateFactor: config.replicationLateFactor,
    stalledFloorHours: config.replicationStalledFloorHours,
    stalledFactor: config.replicationStalledFactor,
  };
}

function currentThresholds() {
  return replicationThresholds({
    ...DEFAULT_SETTINGS_CONFIG,
    ...ensureSettings().config,
  });
}

// When each host last sent its receive history. Health is judged as of then,
// so a silent host freezes its replications rather than ageing them.
export function receiveSightingTimes(): Map<number, Date> {
  const rows = db
    .select({ hostId: collectorRun.hostId, at: max(collectorRun.receivedAt) })
    .from(collectorRun)
    .where(
      and(
        eq(collectorRun.ok, true),
        inArray(collectorRun.source, RECEIVE_SOURCES),
      ),
    )
    .groupBy(collectorRun.hostId)
    .all();
  return new Map(
    rows.flatMap(({ hostId, at }) => (at ? [[hostId, at] as const] : [])),
  );
}

interface Endpoint extends ReplicationEndpoint {
  poolArchived: boolean;
  poolMissing: boolean;
}

function endpoints(
  datasetIds: number[],
  presence: PoolPresenceContext,
): Map<number, Endpoint> {
  if (datasetIds.length === 0) return new Map();
  const paths = poolPaths();
  return new Map(
    db
      .select({
        datasetId: dataset.id,
        datasetName: dataset.name,
        present: dataset.present,
        poolId: pool.id,
        poolName: pool.name,
        poolArchivedAt: pool.archivedAt,
        poolLastSeenAt: pool.lastSeenAt,
        hostId: host.id,
        hostName: host.name,
        hostDisplayName: host.displayName,
      })
      .from(dataset)
      .innerJoin(pool, eq(pool.id, dataset.poolId))
      .innerJoin(host, eq(host.id, pool.hostId))
      .where(inArray(dataset.id, datasetIds))
      .all()
      .map((row) => [
        row.datasetId,
        {
          host: {
            id: row.hostId,
            name: row.hostName,
            displayName: row.hostDisplayName,
          },
          pool: {
            id: row.poolId,
            name: row.poolName,
            path: paths.get(row.poolId) ?? "",
          },
          dataset: {
            id: row.datasetId,
            name: row.datasetName,
            present: row.present,
          },
          poolArchived: row.poolArchivedAt !== null,
          poolMissing:
            poolPresence(
              { hostId: row.hostId, lastSeenAt: row.poolLastSeenAt },
              presence,
            ) === "missing",
        },
      ]),
  );
}

function recentSyncTimes(replicationId: number): Date[] {
  return db
    .select({ at: replicationSync.at })
    .from(replicationSync)
    .where(eq(replicationSync.replicationId, replicationId))
    .orderBy(desc(replicationSync.at))
    .limit(INTERVAL_SYNCS)
    .all()
    .map((row) => row.at);
}

function syncCounts(replicationIds: number[]): Map<number, number> {
  if (replicationIds.length === 0) return new Map();
  return new Map(
    db
      .select({ id: replicationSync.replicationId, total: count() })
      .from(replicationSync)
      .where(inArray(replicationSync.replicationId, replicationIds))
      .groupBy(replicationSync.replicationId)
      .all()
      .map((row) => [row.id, row.total]),
  );
}

export interface ReplicationContext {
  now: Date;
  thresholds: ReplicationThresholds;
  sightings: Map<number, Date>;
  endpoints: Map<number, Endpoint>;
}

export function replicationContext(
  rows: Pick<ReplicationTableRow, "sourceDatasetId" | "targetDatasetId">[],
  now: Date,
): ReplicationContext {
  return {
    now,
    thresholds: currentThresholds(),
    sightings: receiveSightingTimes(),
    endpoints: endpoints(
      [
        ...new Set(
          rows.flatMap((row) =>
            row.sourceDatasetId === null
              ? [row.targetDatasetId]
              : [row.targetDatasetId, row.sourceDatasetId],
          ),
        ),
      ],
      poolPresenceContext(now),
    ),
  };
}

export interface AssessedReplication extends ReplicationHealth {
  row: ReplicationTableRow;
  source: Endpoint | null;
  target: Endpoint | undefined;
  intervalMs: number | null;
}

// A missing pool keeps its datasets marked present, so only a dataset gone
// from a pool still seen counts as destroyed.
function isTargetGone(target: Endpoint | undefined) {
  if (!target) return true;
  return !target.dataset.present && !target.poolMissing;
}

export function assessReplication(
  row: ReplicationTableRow,
  context: ReplicationContext,
): AssessedReplication {
  const target = context.endpoints.get(row.targetDatasetId);
  const source =
    row.sourceDatasetId === null
      ? null
      : (context.endpoints.get(row.sourceDatasetId) ?? null);
  const intervalMs =
    row.manualIntervalSec !== null
      ? row.manualIntervalSec * 1000
      : learntIntervalMs(recentSyncTimes(row.id));
  const sightedAt = target && context.sightings.get(target.host.id);
  const referenceAt =
    sightedAt && sightedAt < context.now ? sightedAt : context.now;
  const health = replicationHealth(
    {
      archived: row.archivedAt !== null || target?.poolArchived === true,
      targetGone: isTargetGone(target),
      sourceGone: source !== null && !source.dataset.present,
      lastSyncAt: row.lastSyncAt,
      intervalMs,
      referenceAt,
    },
    context.thresholds,
  );
  return { ...health, row, source, target, intervalMs };
}

const iso = (date: Date | null) => date?.toISOString() ?? null;

function endpointView(endpoint: Endpoint): ReplicationEndpoint {
  const { poolArchived: _archived, poolMissing: _missing, ...view } = endpoint;
  return view;
}

function present(
  assessed: AssessedReplication,
  syncCount: number,
): ReplicationRow {
  const { row, source, target } = assessed;
  if (!target) throw notFound(`Dataset ${row.targetDatasetId} not found`);
  return {
    id: row.id,
    source: source && endpointView(source),
    target: endpointView(target),
    direction: row.direction,
    status: assessed.status,
    intervalSec:
      assessed.intervalMs === null
        ? null
        : Math.round(assessed.intervalMs / 1000),
    intervalManual: row.manualIntervalSec !== null,
    lastSyncAt: iso(row.lastSyncAt),
    dueAt: iso(assessed.dueAt),
    overdueMs: assessed.overdueMs,
    syncCount,
    archivedAt: iso(row.archivedAt),
    archivedNote: row.archivedNote,
  };
}

const byName = new Intl.Collator("en-GB", { numeric: true }).compare;

function byTarget(a: ReplicationRow, b: ReplicationRow) {
  return (
    byName(a.target.host.name, b.target.host.name) ||
    byName(a.target.dataset.name, b.target.dataset.name)
  );
}

export function listReplications(now = new Date()): ReplicationRow[] {
  const rows = db.select().from(replication).all();
  const context = replicationContext(rows, now);
  const counts = syncCounts(rows.map((row) => row.id));
  return rows
    .map((row) =>
      present(assessReplication(row, context), counts.get(row.id) ?? 0),
    )
    .sort(byTarget);
}

/** Every replication the dataset is the source or target of, as list rows. */
export function replicationsOfDataset(
  datasetId: number,
  now = new Date(),
): ReplicationRow[] {
  const rows = db
    .select()
    .from(replication)
    .where(
      or(
        eq(replication.targetDatasetId, datasetId),
        eq(replication.sourceDatasetId, datasetId),
      ),
    )
    .all();
  const context = replicationContext(rows, now);
  const counts = syncCounts(rows.map((row) => row.id));
  return rows
    .map((row) =>
      present(assessReplication(row, context), counts.get(row.id) ?? 0),
    )
    .sort(byTarget);
}

function replicationRow(id: number): ReplicationTableRow {
  const row = db.select().from(replication).where(eq(replication.id, id)).get();
  if (!row) throw notFound(`Replication ${id} not found`);
  return row;
}

export interface ReplicationSyncPage {
  items: ReplicationSyncView[];
  total: number;
  page: number;
  pageSize: number;
}

function syncPage(replicationId: number, page: number, total: number) {
  const items = db
    .select()
    .from(replicationSync)
    .where(eq(replicationSync.replicationId, replicationId))
    .orderBy(desc(replicationSync.at))
    .limit(REPLICATION_SYNCS_PAGE)
    .offset((page - 1) * REPLICATION_SYNCS_PAGE)
    .all()
    .map(
      (sync): ReplicationSyncView => ({
        id: sync.id,
        at: sync.at.toISOString(),
        snapshotName: sync.snapshotName,
        guid: sync.guid,
        snapshots: sync.snapshots,
      }),
    );
  return { items, total, page, pageSize: REPLICATION_SYNCS_PAGE };
}

type LadderSide = "source" | "target";

function snapshotLadder(
  sourceDatasetId: number | null,
  targetDatasetId: number,
): ReplicationLadderRow[] {
  const datasetIds =
    sourceDatasetId === null
      ? [targetDatasetId]
      : [sourceDatasetId, targetDatasetId];
  const snapshots = db
    .select({
      datasetId: snapshot.datasetId,
      name: snapshot.name,
      guid: snapshot.guid,
      creation: snapshot.creation,
    })
    .from(snapshot)
    .where(inArray(snapshot.datasetId, datasetIds))
    .orderBy(desc(snapshot.creation), desc(snapshot.id))
    .all();
  const rows: ReplicationLadderRow[] = [];
  const byGuid = new Map<string, ReplicationLadderRow>();
  for (const found of snapshots) {
    const side: LadderSide =
      found.datasetId === targetDatasetId ? "target" : "source";
    const entry: ReplicationLadderSnapshot = {
      name: found.name,
      creation: found.creation.toISOString(),
    };
    const shared = found.guid === null ? undefined : byGuid.get(found.guid);
    if (shared && shared[side] === null) {
      shared[side] = entry;
      continue;
    }
    const row: ReplicationLadderRow = {
      source: null,
      target: null,
      guid: found.guid,
      creation: entry.creation,
      [side]: entry,
    };
    rows.push(row);
    if (found.guid !== null) byGuid.set(found.guid, row);
  }
  return rows.slice(0, REPLICATION_LADDER_LIMIT);
}

export interface ReplicationRecord extends ReplicationRow {
  syncs: ReplicationSyncPage;
  ladder: ReplicationLadderRow[];
  diary: DiaryEntry[];
  ends: {
    source: ReplicationEndpointFacts | null;
    target: ReplicationEndpointFacts;
  };
}

function endpointFacts(
  datasetId: number,
  presence: PoolPresenceContext,
): ReplicationEndpointFacts {
  const row = db
    .select({
      referenced: dataset.referenced,
      usedBySnapshots: dataset.usedBySnapshots,
      available: dataset.available,
      compression: dataset.compression,
      compressRatio: dataset.compressRatio,
      encryption: dataset.encryption,
      keyStatus: dataset.keyStatus,
      recordSize: dataset.recordSize,
      mountpoint: dataset.mountpoint,
      creation: dataset.creation,
      pool: {
        hostId: pool.hostId,
        lastSeenAt: pool.lastSeenAt,
        state: pool.state,
        archivedAt: pool.archivedAt,
      },
    })
    .from(dataset)
    .innerJoin(pool, eq(pool.id, dataset.poolId))
    .where(eq(dataset.id, datasetId))
    .get();
  if (!row) throw notFound(`Dataset ${datasetId} not found`);
  const { pool: poolRow, creation, ...facts } = row;
  const snapshotCount =
    db
      .select({ count: count() })
      .from(snapshot)
      .where(eq(snapshot.datasetId, datasetId))
      .get()?.count ?? 0;
  const newest = db
    .select({ name: snapshot.name, creation: snapshot.creation })
    .from(snapshot)
    .where(eq(snapshot.datasetId, datasetId))
    .orderBy(desc(snapshot.creation), desc(snapshot.id))
    .get();
  return {
    pool: {
      state: poolRow.state,
      displayState: poolDisplayState(poolRow, presence),
    },
    dataset: { ...facts, creation: creation.toISOString() },
    snapshots: {
      count: snapshotCount,
      newest: newest
        ? { name: newest.name, creation: newest.creation.toISOString() }
        : null,
    },
  };
}

export function replicationRecord(
  id: number,
  { page = 1 }: { page?: number } = {},
  now = new Date(),
): ReplicationRecord {
  const row = replicationRow(id);
  const total = syncCounts([id]).get(id) ?? 0;
  const view = present(
    assessReplication(row, replicationContext([row], now)),
    total,
  );
  const presence = poolPresenceContext(now);
  return {
    ...view,
    syncs: syncPage(id, page, total),
    ladder: snapshotLadder(row.sourceDatasetId, row.targetDatasetId),
    diary: listDiary({ subjectType: "replication", subjectId: id }),
    ends: {
      source:
        row.sourceDatasetId === null
          ? null
          : endpointFacts(row.sourceDatasetId, presence),
      target: endpointFacts(row.targetDatasetId, presence),
    },
  };
}

function peerView(endpoint: Endpoint, sameHost: boolean): ReplicationPeer {
  return {
    host: {
      name: endpoint.host.name,
      displayName: endpoint.host.displayName,
    },
    pool: endpoint.pool.name,
    dataset: endpoint.dataset.name,
    sameHost,
  };
}

/** Each dataset's replications, as source or target, with status and peer. */
export function datasetReplications(
  datasetIds: number[],
  now = new Date(),
): Map<number, DatasetReplication[]> {
  const byDataset = new Map<number, DatasetReplication[]>();
  if (datasetIds.length === 0) return byDataset;
  const rows = db
    .select()
    .from(replication)
    .where(
      or(
        inArray(replication.targetDatasetId, datasetIds),
        inArray(replication.sourceDatasetId, datasetIds),
      ),
    )
    .all();
  const context = replicationContext(rows, now);
  const wanted = new Set(datasetIds);
  const add = (datasetId: number | null, entry: DatasetReplication) => {
    if (datasetId === null || !wanted.has(datasetId)) return;
    byDataset.set(datasetId, [...(byDataset.get(datasetId) ?? []), entry]);
  };
  for (const row of rows) {
    const { status, source, target } = assessReplication(row, context);
    const sameHost =
      source !== null &&
      target !== undefined &&
      source.host.id === target.host.id;
    const peer = (endpoint: Endpoint | null | undefined) =>
      endpoint ? peerView(endpoint, sameHost) : null;
    add(row.sourceDatasetId, {
      id: row.id,
      role: "source",
      status,
      peer: peer(target),
    });
    add(row.targetDatasetId, {
      id: row.id,
      role: "target",
      status,
      peer: peer(source),
    });
  }
  return byDataset;
}
