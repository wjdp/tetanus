import { and, desc, eq, inArray } from "drizzle-orm";
import type { DiaryEventType } from "#shared/diary";
import type { PoolLastScrub } from "#shared/schemas/pools";
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

function scanCancelled(
  previous: ZpoolStatusScan | null,
  current: ZpoolStatusScan | null,
): current is ZpoolStatusScan {
  if (current?.state !== "CANCELED") return false;
  return (
    previous?.state !== "CANCELED" || previous.startTime !== current.startTime
  );
}

const SCAN_EVENT_TYPES: Record<string, DiaryEventType> = {
  SCRUB: "scrub-finished",
  RESILVER: "resilver-finished",
};

function scanEventType(scanFunction: string): DiaryEventType {
  return SCAN_EVENT_TYPES[scanFunction.toUpperCase()] ?? "scan-finished";
}

const isScrub = (scan: ZpoolStatusScan) =>
  scan.function.toUpperCase() === "SCRUB";

function finishedScrub(
  previous: ZpoolStatusScan | null,
  current: ZpoolStatusScan | null,
): PoolLastScrub | undefined {
  if (!scanFinished(previous, current) || !isScrub(current)) return undefined;
  return {
    endAt: new Date(current.endTime * 1000).toISOString(),
    errors: current.errors,
    repairedBytes: current.processed ?? null,
    durationS: current.endTime - current.startTime,
  };
}

const plural = (count: number, noun: string) =>
  `${count} ${noun}${count === 1 ? "" : "s"}`;

function recordScanChanges(
  poolId: number,
  previous: ZpoolStatusScan | null,
  observed: ZpoolStatusPool,
  receivedAt: Date,
) {
  const { scan } = observed;
  if (scanCancelled(previous, scan)) {
    addAutoEvent({
      subjectType: "pool",
      subjectId: poolId,
      eventType: "scrub-cancelled",
      title: `${observed.name} ${scan.function.toLowerCase()} cancelled`,
      data: {
        function: scan.function,
        examined: scan.examined,
        toExamine: scan.toExamine,
        startTime: scan.startTime,
        endTime: scan.endTime ?? null,
      },
      at:
        scan.endTime === undefined ? receivedAt : new Date(scan.endTime * 1000),
    });
  }
  if (scanFinished(previous, scan)) {
    const {
      function: scanFunction,
      errors,
      examined,
      endTime,
      startTime,
    } = scan;
    addAutoEvent({
      subjectType: "pool",
      subjectId: poolId,
      eventType: scanEventType(scanFunction),
      title: `${observed.name} ${scanFunction.toLowerCase()} finished with ${plural(errors, "error")}`,
      data: {
        function: scanFunction,
        errors,
        examined,
        repairedBytes: scan.processed ?? null,
        startTime,
        endTime,
      },
      at: new Date(endTime * 1000),
    });
  }
}

function recordDataErrorChanges(
  poolId: number,
  previousErrors: number | null,
  observed: ZpoolStatusPool,
  receivedAt: Date,
) {
  const from = previousErrors ?? 0;
  const to = observed.errors ?? 0;
  if (to <= from) return;
  addAutoEvent({
    subjectType: "pool",
    subjectId: poolId,
    eventType: "pool-data-errors-changed",
    title: `${observed.name} has ${plural(to, "data error")} (was ${from})`,
    data: { from, to },
    at: receivedAt,
  });
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
  recordScanChanges(existing.id, existing.scan, observed, receivedAt);
  recordDataErrorChanges(existing.id, existing.errors, observed, receivedAt);
}

function upsertPool(
  observed: ZpoolStatusPool,
  hostId: number,
  receivedAt: Date,
): { row: PoolRow; firstSeen: boolean } {
  const existing = db
    .select()
    .from(pool)
    .where(eq(pool.guid, observed.guid))
    .get();
  const lastScrub = finishedScrub(existing?.scan ?? null, observed.scan);
  const fields = {
    hostId,
    name: observed.name,
    state: observed.state,
    status: observed.status ?? null,
    action: observed.action ?? null,
    msgid: observed.msgid ?? null,
    moreinfo: observed.moreinfo ?? null,
    errors: observed.errors ?? null,
    damagedFiles: observed.damagedFiles ?? null,
    damagedFilesError: observed.damagedFilesError ?? null,
    scan: observed.scan,
    removal: observed.removal,
    ...(lastScrub && { lastScrub }),
    lastSeenAt: receivedAt,
  };
  if (!existing) {
    const row = db
      .insert(pool)
      .values({ ...fields, guid: observed.guid, firstSeenAt: receivedAt })
      .returning()
      .get();
    recordScanChanges(row.id, null, observed, receivedAt);
    recordDataErrorChanges(row.id, null, observed, receivedAt);
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
    role: observed.role,
    state: observed.state,
    spareState: observed.spareState ?? null,
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
      data: {
        poolId: poolRow.id,
        role: observed.role,
        poolState: poolRow.state,
        from: existing.state,
        to: observed.state,
      },
    });
  }
}

const LEAF_TYPES: ReadonlySet<string> = new Set(["disk", "file"]);

type ErrorCounts = Pick<
  VdevRow,
  "readErrors" | "writeErrors" | "checksumErrors"
>;

const errorTotals = (counts: ErrorCounts | undefined) => ({
  read: counts?.readErrors ?? 0,
  write: counts?.writeErrors ?? 0,
  checksum: counts?.checksumErrors ?? 0,
});

function recordLeafErrorChanges(
  existing: VdevRow | undefined,
  row: VdevRow,
  poolRow: PoolRow,
  receivedAt: Date,
) {
  const from = errorTotals(existing);
  const to = errorTotals(row);
  const rose =
    to.read > from.read || to.write > from.write || to.checksum > from.checksum;
  if (!rose) return;
  addAutoEvent({
    subjectType: "pool",
    subjectId: poolRow.id,
    eventType: "leaf-errors-changed",
    title: `${row.name} in ${poolRow.name}: R ${to.read} W ${to.write} C ${to.checksum}`,
    data: {
      poolId: poolRow.id,
      vdevGuid: row.guid,
      leaf: row.name,
      role: LEAF_TYPES.has(row.type) ? row.role : "group",
      diskId: row.diskId,
      from,
      to,
    },
    at: receivedAt,
  });
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
    recordLeafErrorChanges(existing, row, poolRow, receivedAt);
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
