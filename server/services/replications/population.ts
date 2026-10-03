import {
  and,
  asc,
  eq,
  gte,
  inArray,
  isNotNull,
  isNull,
  like,
  lt,
  or,
  sql,
} from "drizzle-orm";
import { db } from "~~/server/database/client";
import {
  dataset,
  pool,
  poolHistory,
  replication,
  replicationSync,
  snapshot,
} from "~~/server/database/schema";
import type { ZpoolHistoryEntry } from "~~/server/ingest/zpool-history";
import { addAutoEvent } from "~~/server/services/diary";
import {
  type DerivedSync,
  deriveSyncs,
  isReceiveLine,
  RECEIVE_LINE_PATTERNS,
  type ReceiveLine,
} from "./derive";
import { resolveReplicationSources } from "./sources";

export type ReplicationRow = typeof replication.$inferSelect;

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
export const RECEIVE_WINDOW_MS = 48 * HOUR_MS;
export const SYNC_RETENTION_DAYS = 400;
const GUID_FILL_WINDOW_MS = 7 * DAY_MS;

export function receiveLines(hostId: number, since?: Date): ReceiveLine[] {
  return db
    .select({ at: poolHistory.at, text: poolHistory.text })
    .from(poolHistory)
    .where(
      and(
        eq(poolHistory.hostId, hostId),
        since ? gte(poolHistory.at, since) : undefined,
        or(
          ...RECEIVE_LINE_PATTERNS.map((pattern) =>
            like(poolHistory.text, pattern),
          ),
        ),
      ),
    )
    .orderBy(asc(poolHistory.at))
    .all();
}

interface Target {
  datasetId: number;
  poolArchived: boolean;
}

function presentTargets(hostId: number): Map<string, Target> {
  return new Map(
    db
      .select({
        name: dataset.name,
        datasetId: dataset.id,
        archivedAt: pool.archivedAt,
      })
      .from(dataset)
      .innerJoin(pool, eq(pool.id, dataset.poolId))
      .where(and(eq(pool.hostId, hostId), eq(dataset.present, true)))
      .all()
      .map((row) => [
        row.name,
        { datasetId: row.datasetId, poolArchived: row.archivedAt !== null },
      ]),
  );
}

function replicationsByTarget(datasetIds: number[]) {
  if (datasetIds.length === 0) return new Map<number, ReplicationRow>();
  return new Map(
    db
      .select()
      .from(replication)
      .where(inArray(replication.targetDatasetId, datasetIds))
      .all()
      .map((row) => [row.targetDatasetId, row]),
  );
}

function discover(
  target: string,
  datasetId: number,
  sync: DerivedSync,
  seenAt: Date,
): ReplicationRow {
  const row = db
    .insert(replication)
    .values({
      targetDatasetId: datasetId,
      direction: "received",
      firstSeenAt: sync.at,
      lastSeenAt: seenAt,
    })
    .returning()
    .get();
  addAutoEvent({
    subjectType: "replication",
    subjectId: row.id,
    eventType: "replication-discovered",
    title: `Replication into ${target} discovered`,
    data: { targetDatasetId: datasetId },
    at: sync.at,
  });
  return row;
}

function resume(row: ReplicationRow, target: string, at: Date) {
  db.update(replication)
    .set({ archivedAt: null, archivedNote: "" })
    .where(eq(replication.id, row.id))
    .run();
  addAutoEvent({
    subjectType: "replication",
    subjectId: row.id,
    eventType: "replication-resumed",
    title: `Replication into ${target} resumed`,
    data: { archivedAt: row.archivedAt?.toISOString() ?? null },
    at,
  });
  return { ...row, archivedAt: null, archivedNote: "" };
}

function targetGuid(datasetId: number, snapshotName: string | null) {
  if (snapshotName === null) return null;
  return (
    db
      .select({ guid: snapshot.guid })
      .from(snapshot)
      .where(
        and(eq(snapshot.datasetId, datasetId), eq(snapshot.name, snapshotName)),
      )
      .get()?.guid ?? null
  );
}

function upsertSync(row: ReplicationRow, sync: DerivedSync) {
  db.insert(replicationSync)
    .values({
      replicationId: row.id,
      at: sync.at,
      snapshotName: sync.snapshotName,
      guid: targetGuid(row.targetDatasetId, sync.snapshotName),
      snapshots: sync.snapshots,
    })
    .onConflictDoUpdate({
      target: [replicationSync.replicationId, replicationSync.at],
      set: {
        snapshotName: sql`excluded.snapshotName`,
        guid: sql`coalesce(${replicationSync.guid}, excluded.guid)`,
        snapshots: sql`max(${replicationSync.snapshots}, excluded.snapshots)`,
      },
    })
    .run();
}

/**
 * Stores syncs of one host: a sync into a present dataset of a pool that is
 * not archived discovers its replication.
 */
export function recordSyncs(
  hostId: number,
  syncs: DerivedSync[],
  seenAt: Date,
): number {
  const targets = presentTargets(hostId);
  const replications = replicationsByTarget(
    [...targets.values()].map((target) => target.datasetId),
  );
  const touched = new Map<number, { row: ReplicationRow; lastSyncAt: Date }>();
  for (const sync of syncs) {
    const target = targets.get(sync.target);
    if (!target) continue;
    let row = replications.get(target.datasetId);
    if (!row) {
      if (target.poolArchived) continue;
      row = discover(sync.target, target.datasetId, sync, seenAt);
    }
    if (row.archivedAt && sync.at > row.archivedAt) {
      row = resume(row, sync.target, sync.at);
    }
    replications.set(target.datasetId, row);
    upsertSync(row, sync);
    const lastSyncAt = touched.get(row.id)?.lastSyncAt;
    touched.set(row.id, {
      row,
      lastSyncAt: lastSyncAt && lastSyncAt > sync.at ? lastSyncAt : sync.at,
    });
  }
  for (const { row, lastSyncAt } of touched.values()) {
    db.update(replication)
      .set({
        lastSyncAt:
          row.lastSyncAt && row.lastSyncAt > lastSyncAt
            ? row.lastSyncAt
            : lastSyncAt,
        lastSeenAt: row.lastSeenAt > seenAt ? row.lastSeenAt : seenAt,
      })
      .where(eq(replication.id, row.id))
      .run();
  }
  return touched.size;
}

export function pruneSyncs(now: Date) {
  db.delete(replicationSync)
    .where(
      lt(
        replicationSync.at,
        new Date(now.getTime() - SYNC_RETENTION_DAYS * DAY_MS),
      ),
    )
    .run();
}

/** Syncs logged before their snapshot was listed take its guid once it is. */
export function fillSyncGuids(now: Date) {
  db.update(replicationSync)
    .set({
      guid: sql`(
        SELECT ${snapshot.guid} FROM ${snapshot}
        JOIN ${replication} ON ${replication.targetDatasetId} = ${snapshot.datasetId}
        WHERE ${replication.id} = ${replicationSync.replicationId}
          AND ${snapshot.name} = ${replicationSync.snapshotName}
      )`,
    })
    .where(
      and(
        isNull(replicationSync.guid),
        isNotNull(replicationSync.snapshotName),
        gte(replicationSync.at, new Date(now.getTime() - GUID_FILL_WINDOW_MS)),
      ),
    )
    .run();
}

function earliest(lines: ReceiveLine[], fallback: Date) {
  return lines.reduce((min, line) => (line.at < min ? line.at : min), fallback);
}

/**
 * Re-derives the host's syncs after a history payload: from 48 h before its
 * oldest receive line, so a first backfill of months is taken in whole.
 */
export function observeReceives(
  hostId: number,
  entries: Pick<ZpoolHistoryEntry, "at" | "text">[],
  receivedAt: Date,
) {
  const received = entries
    .filter((entry) => isReceiveLine(entry.text))
    .map((entry) => ({ at: new Date(entry.at), text: entry.text }));
  const since = new Date(
    earliest(received, receivedAt).getTime() - RECEIVE_WINDOW_MS,
  );
  recordSyncs(
    hostId,
    deriveSyncs(receiveLines(hostId, since), receivedAt),
    receivedAt,
  );
  pruneSyncs(receivedAt);
  resolveReplicationSources();
}

export function observeSnapshotsForReplications(receivedAt: Date) {
  fillSyncGuids(receivedAt);
  resolveReplicationSources();
}
