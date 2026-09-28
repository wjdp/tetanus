import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "~~/server/database/client";
import {
  pool,
  poolReading,
  vdev,
  vdevReading,
} from "~~/server/database/schema";
import type {
  ZpoolListProperty,
  ZpoolListResult,
} from "~~/server/ingest/zpool-list";
import type {
  ZpoolStatusPool,
  ZpoolStatusResult,
  ZpoolStatusScan,
  ZpoolStatusVdev,
} from "~~/server/ingest/zpool-status";
import { addAutoEvent } from "~~/server/services/diary";
import { findDiskByAlias, findDiskByKey } from "~~/server/services/disks";

export type PoolRow = typeof pool.$inferSelect;
export type VdevRow = typeof vdev.$inferSelect;

const BY_VDEV_PREFIX = "/dev/disk/by-vdev/";
const BY_ID_PREFIX = "/dev/disk/by-id/";
const PARTITION_SUFFIX = /-part\d+$/;
const WWN_BY_ID = /^(?:wwn-|scsi-3)((?:0x)?[0-9a-f]{16,32})$/i;

function wholeDiskName(name: string) {
  return name.replace(PARTITION_SUFFIX, "");
}

function diskIdByIdName(name: string): number | null {
  const byId = wholeDiskName(name);
  const found = findDiskByKey("by-id", byId);
  if (found) return found.id;
  const wwn = WWN_BY_ID.exec(byId)?.[1];
  return wwn ? (findDiskByKey("wwn", wwn)?.id ?? null) : null;
}

export function resolveLeafDiskId({
  path,
  devid,
}: Pick<ZpoolStatusVdev, "path" | "devid">): number | null {
  if (path?.startsWith(BY_VDEV_PREFIX)) {
    const alias = wholeDiskName(path.slice(BY_VDEV_PREFIX.length));
    const found = findDiskByAlias(alias);
    if (found) return found.id;
  }
  if (path?.startsWith(BY_ID_PREFIX)) {
    const found = diskIdByIdName(path.slice(BY_ID_PREFIX.length));
    if (found !== null) return found;
  }
  return devid ? diskIdByIdName(devid) : null;
}

function scanFinished(
  previous: ZpoolStatusScan | null,
  current: ZpoolStatusScan | null,
): current is ZpoolStatusScan & { endTime: number } {
  if (current?.state !== "FINISHED" || current.endTime === undefined) {
    return false;
  }
  return previous?.state !== "FINISHED" || previous.endTime !== current.endTime;
}

function recordPoolChanges(
  existing: PoolRow,
  observed: ZpoolStatusPool,
  hostId: number,
  receivedAt: Date,
) {
  if (existing.hostId !== hostId) {
    addAutoEvent({
      subjectType: "pool",
      subjectId: existing.id,
      eventType: "pool-moved",
      title: `${observed.name} moved to another host`,
      data: { fromHostId: existing.hostId, toHostId: hostId },
      at: receivedAt,
    });
  }
  if (existing.state !== observed.state) {
    addAutoEvent({
      subjectType: "pool",
      subjectId: existing.id,
      eventType: "pool-state-changed",
      title: `${observed.name} ${observed.state} (was ${existing.state})`,
      data: { from: existing.state, to: observed.state },
      at: receivedAt,
    });
  }
  if (scanFinished(existing.scan, observed.scan)) {
    const { function: scanFunction, errors, examined, endTime } = observed.scan;
    addAutoEvent({
      subjectType: "pool",
      subjectId: existing.id,
      eventType: "scan-finished",
      title: `${observed.name} ${scanFunction.toLowerCase()} finished with ${errors} error${errors === 1 ? "" : "s"}`,
      data: { function: scanFunction, errors, examined, endTime },
      at: new Date(endTime * 1000),
    });
  }
}

function upsertPool(
  observed: ZpoolStatusPool,
  hostId: number,
  receivedAt: Date,
): { row: PoolRow; firstSeen: boolean } {
  const fields = {
    hostId,
    name: observed.name,
    state: observed.state,
    status: observed.status ?? null,
    action: observed.action ?? null,
    errors: observed.errors ?? null,
    scan: observed.scan,
    lastSeenAt: receivedAt,
  };
  const existing = db
    .select()
    .from(pool)
    .where(eq(pool.guid, observed.guid))
    .get();
  if (!existing) {
    const row = db
      .insert(pool)
      .values({ ...fields, guid: observed.guid, firstSeenAt: receivedAt })
      .returning()
      .get();
    return { row, firstSeen: true };
  }
  recordPoolChanges(existing, observed, hostId, receivedAt);
  const row = db
    .update(pool)
    .set(fields)
    .where(eq(pool.id, existing.id))
    .returning()
    .get();
  return { row, firstSeen: false };
}

function vdevFields(observed: ZpoolStatusVdev) {
  return {
    name: observed.name,
    type: observed.type,
    state: observed.state,
    readErrors: observed.readErrors,
    writeErrors: observed.writeErrors,
    checksumErrors: observed.checksumErrors,
    slowIos: observed.slowIos ?? null,
    path: observed.path ?? null,
    devid: observed.devid ?? null,
    physPath: observed.physPath ?? null,
    diskId: observed.type === "disk" ? resolveLeafDiskId(observed) : null,
    allocBytes: observed.allocSpace ?? null,
    sizeBytes: observed.totalSpace ?? null,
    frag: observed.fragmentation ?? null,
  };
}

function recordVdevChanges(
  existing: VdevRow | undefined,
  observed: ZpoolStatusVdev,
  poolRow: PoolRow,
  vdevId: number,
  firstSeen: boolean,
  receivedAt: Date,
) {
  const common = {
    subjectType: "vdev" as const,
    subjectId: vdevId,
    at: receivedAt,
  };
  if (!existing?.present) {
    if (firstSeen || observed.type === "root") return;
    addAutoEvent({
      ...common,
      eventType: "vdev-joined",
      title: `${observed.name} joined ${poolRow.name}`,
      data: { poolId: poolRow.id, rejoined: existing !== undefined },
    });
    return;
  }
  if (existing.state !== observed.state) {
    addAutoEvent({
      ...common,
      eventType: "vdev-state-changed",
      title: `${observed.name} ${observed.state} (was ${existing.state})`,
      data: { poolId: poolRow.id, from: existing.state, to: observed.state },
    });
  }
}

type ReadingFields = Pick<
  VdevRow,
  "readErrors" | "writeErrors" | "checksumErrors" | "slowIos" | "state"
>;

function readingChanged(previous: ReadingFields, current: ReadingFields) {
  return (
    previous.readErrors !== current.readErrors ||
    previous.writeErrors !== current.writeErrors ||
    previous.checksumErrors !== current.checksumErrors ||
    previous.slowIos !== current.slowIos ||
    previous.state !== current.state
  );
}

function recordVdevReading(row: VdevRow, receivedAt: Date) {
  const latest = db
    .select()
    .from(vdevReading)
    .where(eq(vdevReading.vdevId, row.id))
    .orderBy(desc(vdevReading.at), desc(vdevReading.id))
    .limit(1)
    .get();
  if (latest && !readingChanged(latest, row)) return;
  db.insert(vdevReading)
    .values({
      vdevId: row.id,
      at: receivedAt,
      readErrors: row.readErrors,
      writeErrors: row.writeErrors,
      checksumErrors: row.checksumErrors,
      slowIos: row.slowIos,
      state: row.state,
    })
    .run();
}

function upsertVdevs(
  poolRow: PoolRow,
  observedVdevs: ZpoolStatusVdev[],
  firstSeen: boolean,
  receivedAt: Date,
) {
  const observedGuids = observedVdevs.map((observed) => observed.guid);
  const existingByGuid = new Map(
    db
      .select()
      .from(vdev)
      .where(
        observedGuids.length > 0
          ? inArray(vdev.guid, observedGuids)
          : eq(vdev.poolId, poolRow.id),
      )
      .all()
      .map((row) => [row.guid, row]),
  );

  const idByGuid = new Map<string, number>();
  for (const observed of observedVdevs) {
    const existing = existingByGuid.get(observed.guid);
    const values = {
      ...vdevFields(observed),
      poolId: poolRow.id,
      present: true,
      lastSeenAt: receivedAt,
    };
    const row = existing
      ? db
          .update(vdev)
          .set(values)
          .where(eq(vdev.id, existing.id))
          .returning()
          .get()
      : db
          .insert(vdev)
          .values({ ...values, guid: observed.guid })
          .returning()
          .get();
    idByGuid.set(observed.guid, row.id);
    recordVdevChanges(
      existing,
      observed,
      poolRow,
      row.id,
      firstSeen,
      receivedAt,
    );
    recordVdevReading(row, receivedAt);
  }

  for (const observed of observedVdevs) {
    const parentId =
      observed.parentGuid === null
        ? null
        : (idByGuid.get(observed.parentGuid) ?? null);
    db.update(vdev).set({ parentId }).where(eq(vdev.guid, observed.guid)).run();
  }

  markAbsentVdevs(poolRow, new Set(observedGuids), receivedAt);
}

function markAbsentVdevs(
  poolRow: PoolRow,
  observedGuids: Set<string>,
  receivedAt: Date,
) {
  const departed = db
    .select()
    .from(vdev)
    .where(and(eq(vdev.poolId, poolRow.id), eq(vdev.present, true)))
    .all()
    .filter((row) => !observedGuids.has(row.guid));
  for (const row of departed) {
    db.update(vdev).set({ present: false }).where(eq(vdev.id, row.id)).run();
    addAutoEvent({
      subjectType: "vdev",
      subjectId: row.id,
      eventType: "vdev-left",
      title: `${row.name} left ${poolRow.name}`,
      data: { poolId: poolRow.id, lastState: row.state },
      at: receivedAt,
    });
  }
}

function recordPoolReading(row: PoolRow, receivedAt: Date) {
  db.insert(poolReading)
    .values({
      poolId: row.id,
      at: receivedAt,
      allocBytes: row.allocBytes,
      freeBytes: row.freeBytes,
      frag: row.frag,
      cap: row.cap,
      state: row.state,
    })
    .run();
}

export function observeZpoolStatus(
  hostId: number,
  { pools }: ZpoolStatusResult,
  receivedAt: Date,
) {
  for (const observed of pools) {
    const { row, firstSeen } = upsertPool(observed, hostId, receivedAt);
    upsertVdevs(row, observed.vdevs, firstSeen, receivedAt);
    recordPoolReading(row, receivedAt);
  }
}

function numericProperty(property: ZpoolListProperty | undefined) {
  if (property === undefined) return null;
  const value =
    typeof property.value === "number"
      ? property.value
      : Number.parseFloat(property.value);
  return Number.isFinite(value) ? value : null;
}

function textProperty(property: ZpoolListProperty | undefined) {
  if (property === undefined || property.value === "-") return null;
  return String(property.value);
}

export function observeZpoolList({ pools }: ZpoolListResult) {
  for (const { guid, properties } of pools) {
    db.update(pool)
      .set({
        sizeBytes: numericProperty(properties.size),
        allocBytes: numericProperty(properties.allocated),
        freeBytes: numericProperty(properties.free),
        frag: numericProperty(properties.fragmentation),
        cap: numericProperty(properties.capacity),
        dedup: numericProperty(properties.dedupratio),
        health: textProperty(properties.health),
      })
      .where(eq(pool.guid, guid))
      .run();
  }
}
