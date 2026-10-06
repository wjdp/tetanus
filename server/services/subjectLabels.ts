import { eq, inArray } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";
import type { DiarySubjectType } from "#shared/diary";
import { describeDisk } from "#shared/disk";
import { datasetPath, hostPath } from "#shared/entityPaths";
import { replicationLabel } from "#shared/replications";
import { db } from "~~/server/database/client";
import {
  dataset,
  disk,
  host,
  pool,
  replication,
  vdev,
} from "~~/server/database/schema";
import { poolPaths } from "~~/server/services/zfs/paths";

export interface SubjectRef {
  subjectType: DiarySubjectType;
  subjectId: number | null;
}

type Labeller = (ids: number[]) => [number, string, string | null][];

const hostLabel = (row: { name: string; displayName: string | null }) =>
  row.displayName || row.name;

type NamedSubjectType = Exclude<DiarySubjectType, "system">;

const LABELLERS: Record<NamedSubjectType, Labeller> = {
  disk: (ids) =>
    db
      .select({
        id: disk.id,
        alias: disk.alias,
        model: disk.model,
        serial: disk.serial,
      })
      .from(disk)
      .where(inArray(disk.id, ids))
      .all()
      .map((row) => [row.id, describeDisk(row), `/disks/${row.id}`]),
  pool: (ids) => {
    const paths = poolPaths();
    return db
      .select({ id: pool.id, name: pool.name })
      .from(pool)
      .where(inArray(pool.id, ids))
      .all()
      .map((row) => [row.id, row.name, paths.get(row.id) ?? null]);
  },
  vdev: (ids) =>
    db
      .select({ id: vdev.id, name: vdev.name, poolName: pool.name })
      .from(vdev)
      .innerJoin(pool, eq(pool.id, vdev.poolId))
      .where(inArray(vdev.id, ids))
      .all()
      .map((row) => [row.id, `${row.poolName} · ${row.name}`, null]),
  dataset: (ids) => {
    const paths = poolPaths();
    return db
      .select({
        id: dataset.id,
        name: dataset.name,
        poolId: dataset.poolId,
        hostName: host.name,
        hostDisplayName: host.displayName,
      })
      .from(dataset)
      .innerJoin(pool, eq(pool.id, dataset.poolId))
      .innerJoin(host, eq(host.id, pool.hostId))
      .where(inArray(dataset.id, ids))
      .all()
      .map((row) => [
        row.id,
        `${hostLabel({ name: row.hostName, displayName: row.hostDisplayName })} · ${row.name}`,
        datasetPathOf(paths.get(row.poolId), row.name),
      ]);
  },
  replication: (ids) => {
    const source = alias(dataset, "source");
    return db
      .select({
        id: replication.id,
        targetName: dataset.name,
        sourceName: source.name,
      })
      .from(replication)
      .innerJoin(dataset, eq(dataset.id, replication.targetDatasetId))
      .leftJoin(source, eq(source.id, replication.sourceDatasetId))
      .where(inArray(replication.id, ids))
      .all()
      .map((row) => [row.id, replicationLabel(row), `/replications/${row.id}`]);
  },
  host: (ids) =>
    db
      .select({ id: host.id, name: host.name, displayName: host.displayName })
      .from(host)
      .where(inArray(host.id, ids))
      .all()
      .map((row) => [row.id, hostLabel(row), hostPath(row.name)]),
};

const datasetPathOf = (poolPathOf: string | undefined, name: string) =>
  poolPathOf ? datasetPath(poolPathOf, name) : null;

const subjectKey = ({ subjectType, subjectId }: SubjectRef) =>
  `${subjectType}:${subjectId}`;

export function labelSubjects<Entry extends SubjectRef>(
  entries: Entry[],
): (Entry & { subjectLabel: string | null; subjectPath: string | null })[] {
  const idsByType = new Map<NamedSubjectType, Set<number>>();
  for (const { subjectType, subjectId } of entries) {
    if (subjectId === null || subjectType === "system") continue;
    const ids = idsByType.get(subjectType) ?? new Set();
    ids.add(subjectId);
    idsByType.set(subjectType, ids);
  }
  const labels = new Map<string, string>();
  const paths = new Map<string, string | null>();
  for (const [subjectType, ids] of idsByType) {
    for (const [subjectId, label, path] of LABELLERS[subjectType]([...ids])) {
      const key = subjectKey({ subjectType, subjectId });
      labels.set(key, label);
      paths.set(key, path);
    }
  }
  return entries.map((entry) => ({
    ...entry,
    subjectLabel:
      entry.subjectId === null
        ? null
        : (labels.get(subjectKey(entry)) ?? `removed ${entry.subjectType}`),
    subjectPath: paths.get(subjectKey(entry)) ?? null,
  }));
}
