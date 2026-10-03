import { and, asc, count, eq, inArray, isNotNull, max, ne } from "drizzle-orm";
import { db } from "~~/server/database/client";
import { dataset, replication, snapshot } from "~~/server/database/schema";

type ReplicationRow = typeof replication.$inferSelect;

interface Candidate {
  datasetId: number;
  newestCommonAt: Date | null;
  common: number;
  firstSeenAt: Date;
}

function candidates(targetDatasetId: number, targetPoolId: number) {
  const targetGuids = db
    .select({ guid: snapshot.guid })
    .from(snapshot)
    .where(
      and(eq(snapshot.datasetId, targetDatasetId), isNotNull(snapshot.guid)),
    );
  return db
    .select({
      datasetId: snapshot.datasetId,
      newestCommonAt: max(snapshot.creation),
      common: count(),
      firstSeenAt: dataset.firstSeenAt,
    })
    .from(snapshot)
    .innerJoin(dataset, eq(dataset.id, snapshot.datasetId))
    .where(
      and(
        inArray(snapshot.guid, targetGuids),
        ne(dataset.poolId, targetPoolId),
        eq(dataset.present, true),
      ),
    )
    .groupBy(snapshot.datasetId, dataset.firstSeenAt)
    .all();
}

const time = (at: Date | null) => at?.getTime() ?? 0;

/**
 * A present dataset on another pool holding a guid the target holds. Prefer
 * one that is not itself a target, then the newest common snapshot, then the
 * most snapshots in common, then the longest known; never a dataset this
 * target replicates into (a restore).
 */
export function chooseSource(
  row: Pick<ReplicationRow, "targetDatasetId">,
  replications: Pick<ReplicationRow, "sourceDatasetId" | "targetDatasetId">[],
): number | null {
  const target = db
    .select({ poolId: dataset.poolId, present: dataset.present })
    .from(dataset)
    .where(eq(dataset.id, row.targetDatasetId))
    .get();
  if (!target?.present) return null;
  const targets = new Set(replications.map((other) => other.targetDatasetId));
  const restores = new Set(
    replications
      .filter((other) => other.sourceDatasetId === row.targetDatasetId)
      .map((other) => other.targetDatasetId),
  );
  const isTarget = (candidate: Candidate) =>
    targets.has(candidate.datasetId) ? 1 : 0;
  const [best] = candidates(row.targetDatasetId, target.poolId)
    .filter((candidate) => !restores.has(candidate.datasetId))
    .sort(
      (a, b) =>
        isTarget(a) - isTarget(b) ||
        time(b.newestCommonAt) - time(a.newestCommonAt) ||
        b.common - a.common ||
        a.firstSeenAt.getTime() - b.firstSeenAt.getTime() ||
        a.datasetId - b.datasetId,
    );
  return best?.datasetId ?? null;
}

/**
 * Decides each discovered replication's source once, oldest first so a later
 * restore is told apart; a stored source stays.
 */
export function resolveReplicationSources(): number {
  const replications = db
    .select()
    .from(replication)
    .orderBy(asc(replication.firstSeenAt), asc(replication.id))
    .all();
  let resolved = 0;
  for (const row of replications) {
    if (row.sourceDatasetId !== null || row.direction !== "received") continue;
    const sourceDatasetId = chooseSource(row, replications);
    if (sourceDatasetId === null) continue;
    db.update(replication)
      .set({ sourceDatasetId })
      .where(eq(replication.id, row.id))
      .run();
    row.sourceDatasetId = sourceDatasetId;
    resolved += 1;
  }
  return resolved;
}
