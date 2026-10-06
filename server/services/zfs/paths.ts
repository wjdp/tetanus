import { and, eq } from "drizzle-orm";
import {
  datasetPath,
  hostPath,
  parseZfsPath,
  poolPath,
  poolSlugs,
} from "#shared/entityPaths";
import { db } from "~~/server/database/client";
import { dataset, host, pool } from "~~/server/database/schema";
import { notFound } from "~~/server/utils/serviceError";

export type ZfsPathTarget =
  | { kind: "pool"; id: number }
  | { kind: "dataset"; id: number };

export type LegacyKind = "hosts" | "zfs" | "datasets";

/** Page paths of every pool, keyed by id; slugs depend on same-named siblings, so this always reads the whole table. */
export function poolPaths(): Map<number, string> {
  const rows = db
    .select({
      id: pool.id,
      hostId: pool.hostId,
      name: pool.name,
      guid: pool.guid,
      archivedAt: pool.archivedAt,
      lastSeenAt: pool.lastSeenAt,
      hostName: host.name,
    })
    .from(pool)
    .innerJoin(host, eq(host.id, pool.hostId))
    .all();
  const slugs = poolSlugs(rows);
  return new Map(
    rows.map((row) => [
      row.id,
      poolPath(row.hostName, slugs.get(row.id) ?? row.name),
    ]),
  );
}

export function resolveZfsPath(
  hostName: string,
  segments: string[],
): ZfsPathTarget {
  const target = parseZfsPath(segments);
  const missing = () => notFound(`No pool or dataset at ${segments.join("/")}`);
  if (!target) throw missing();
  const hostRow = db
    .select({ id: host.id })
    .from(host)
    .where(eq(host.name, hostName))
    .get();
  if (!hostRow) throw notFound(`Host ${hostName} not found`);
  const candidates = db
    .select({
      id: pool.id,
      hostId: pool.hostId,
      name: pool.name,
      guid: pool.guid,
      archivedAt: pool.archivedAt,
      lastSeenAt: pool.lastSeenAt,
    })
    .from(pool)
    .where(eq(pool.hostId, hostRow.id))
    .all();
  const slugs = poolSlugs(candidates);
  const poolId = candidates.find(
    (candidate) => slugs.get(candidate.id) === target.poolSlug,
  )?.id;
  if (poolId === undefined) throw missing();
  if (target.datasetName === null) return { kind: "pool", id: poolId };
  const datasetRow = db
    .select({ id: dataset.id })
    .from(dataset)
    .where(
      and(eq(dataset.poolId, poolId), eq(dataset.name, target.datasetName)),
    )
    .get();
  if (!datasetRow) throw missing();
  return { kind: "dataset", id: datasetRow.id };
}

/** The current page path for an old id-based URL, or null when nothing has that id. */
export function legacyPath(kind: LegacyKind, id: number): string | null {
  if (kind === "hosts") {
    const row = db
      .select({ name: host.name })
      .from(host)
      .where(eq(host.id, id))
      .get();
    return row ? hostPath(row.name) : null;
  }
  if (kind === "zfs") return poolPaths().get(id) ?? null;
  const row = db
    .select({ name: dataset.name, poolId: dataset.poolId })
    .from(dataset)
    .where(eq(dataset.id, id))
    .get();
  const poolPathOf = row && poolPaths().get(row.poolId);
  return row && poolPathOf ? datasetPath(poolPathOf, row.name) : null;
}

export function hostNameExists(name: string): boolean {
  return (
    db.select({ id: host.id }).from(host).where(eq(host.name, name)).get() !==
    undefined
  );
}
