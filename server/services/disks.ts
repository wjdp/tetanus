import {
  and,
  asc,
  count,
  desc,
  eq,
  inArray,
  isNotNull,
  isNull,
  sql,
} from "drizzle-orm";
import { alias as aliasedTable } from "drizzle-orm/sqlite-core";
import type { Bay } from "#shared/bays";
import {
  type DiskKey,
  type DiskKeyKind,
  type DiskProtocol,
  type DiskState,
  type Disposal,
  describeDisk,
  type EffectiveDiskState,
  isDisposed,
} from "#shared/disk";
import {
  type DiskFaultCounts,
  LIVE_FAULT_STATES,
  NO_DISK_FAULTS,
} from "#shared/faults";
import {
  interfaceLabel,
  type SectorFormat,
  sectorFormat,
} from "#shared/hardware";
import type { IngestMeta } from "#shared/ingest";
import type { Inventory } from "#shared/inventory-fields";
import { resolveModelShort } from "#shared/model";
import { formatMoney } from "#shared/money";
import type { DiskPatch } from "#shared/schemas/disks";
import {
  counterAttributeIds,
  countersFrom,
  type DiskCounters,
  NO_COUNTERS,
} from "#shared/smart/counters";
import type { AcceptedLevel } from "#shared/smart/status";
import {
  resolveTemperatureThresholds,
  type TemperatureThresholds,
} from "#shared/temperature";
import {
  type DiskUsage,
  isMounted,
  type Purpose,
  UNKNOWN_USAGE,
} from "#shared/usage";
import { detectVendor } from "#shared/vendor";
import { effectiveWarranty } from "#shared/warranty";
import { db } from "~~/server/database/client";
import {
  disk,
  diskKey,
  fault,
  faultAcceptance,
  host,
  pool,
  smartAttribute,
  smartReading,
  vdev,
} from "~~/server/database/schema";
import type { LsblkResult } from "~~/server/ingest/lsblk";
import type { SmartctlXallResult } from "~~/server/ingest/smartctl-xall";
import type { UdevResult } from "~~/server/ingest/udev";
import type { VdevIdConfResult } from "~~/server/ingest/vdev-id-conf";
import { baysOf } from "~~/server/services/bays";
import {
  addAutoEvent,
  countDiary,
  latestAutoEvent,
} from "~~/server/services/diary";
import {
  type DerivedHardware,
  deriveHardware,
  hardwareFromSmartctl,
  hardwareHintsFromLsblk,
  recordingTechChanges,
  zonedChanges,
} from "~~/server/services/hardware";
import { diskSightingTimes } from "~~/server/services/hosts";
import {
  extractKeys,
  isPartitionName,
  keysFromVdevTarget,
  matchDisks,
  normaliseKey,
  scrutinyUuid,
} from "~~/server/services/identity";
import { getSettings } from "~~/server/services/settings";
import { inferUsage, resolvePurpose } from "~~/server/services/usage";
import { notFound, ServiceError } from "~~/server/utils/serviceError";

export type DiskRow = typeof disk.$inferSelect;

export type DiskIdentity = Partial<
  Pick<
    DiskRow,
    | "scrutinyUuid"
    | "model"
    | "modelFamily"
    | "serial"
    | "firmware"
    | "capacityBytes"
    | "rotationRate"
    | "protocol"
    | "link"
    | "formFactor"
    | "media"
    | "interface"
    | "logicalBlockSize"
    | "physicalBlockSize"
    | "trimSupported"
    | "hardware"
    | "vendor"
  >
>;

export interface DiskSighting {
  hostId: number;
  receivedAt: Date;
  keys: DiskKey[];
  identity?: DiskIdentity;
  identityHints?: DiskIdentity;
  derive?: (previous: DiskRow | undefined) => DerivedHardware;
  devicePath?: string | null;
  deviceType?: string | null;
}

export type AliasSource = "udev" | "vdev-id-conf";

export interface DiskMembership {
  poolId: number;
  poolName: string;
  poolArchived: boolean;
  vdevName: string;
  groupName: string | null;
  groupType: string | null;
  vdevState: string;
}

export interface DiskSummary
  extends Omit<DiskRow, "latestRaw" | "latestUsage"> {
  keys: DiskKey[];
  membership: DiskMembership | null;
  state: EffectiveDiskState;
  inferredState: DiskState;
  hostName: string | null;
  replacedByDiskId: number | null;
  ageDays: number | null;
  warrantyDaysLeft: number | null;
  usage: DiskUsage;
  purpose: Purpose | null;
  purposeInferred: boolean;
  sectorFormat: SectorFormat | null;
  interfaceLabel: string | null;
  present: boolean;
  stateAsOf: Date | null;
  modelShort: string | null;
  tempThresholds: TemperatureThresholds;
  counters: DiskCounters;
  faultCounts: DiskFaultCounts;
  bay: Bay | null;
}

export interface DisposedDiskSighting {
  at: Date;
  title: string;
}

export interface DiskDetail extends DiskSummary {
  latestRaw: string | null;
  diaryCount: number;
  seenSinceDisposal: DisposedDiskSighting | null;
}

export interface StateContext {
  inPool: boolean;
  present: boolean;
  mounted: boolean;
  now: Date;
  missingAfterDays: number;
}

export const PRESENT_WINDOW_MS = 2 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

export function getDiskRow(id: number): DiskRow | undefined {
  return db.select().from(disk).where(eq(disk.id, id)).get();
}

function keysOf(diskIds: number[]) {
  if (diskIds.length === 0) return new Map<number, DiskKey[]>();
  const rows = db
    .select()
    .from(diskKey)
    .where(inArray(diskKey.diskId, diskIds))
    .orderBy(asc(diskKey.kind), asc(diskKey.value))
    .all();
  const byDisk = new Map<number, DiskKey[]>();
  for (const row of rows) {
    const keys = byDisk.get(row.diskId) ?? [];
    keys.push({ kind: row.kind, value: row.value });
    byDisk.set(row.diskId, keys);
  }
  return byDisk;
}

function existingKeysMatching(keys: DiskKey[]) {
  return db
    .select({
      diskId: diskKey.diskId,
      kind: diskKey.kind,
      value: diskKey.value,
    })
    .from(diskKey)
    .where(
      inArray(
        diskKey.value,
        keys.map((key) => key.value),
      ),
    )
    .all();
}

export function matchKeys(keys: DiskKey[]) {
  return matchDisks(keys, existingKeysMatching(keys));
}

export function findDiskByKey(
  kind: DiskKeyKind,
  value: string,
): DiskRow | undefined {
  return db
    .select({ disk })
    .from(diskKey)
    .innerJoin(disk, eq(disk.id, diskKey.diskId))
    .where(
      and(eq(diskKey.kind, kind), eq(diskKey.value, normaliseKey(kind, value))),
    )
    .get()?.disk;
}

export function findDiskByAlias(alias: string): DiskRow | undefined {
  return db.select().from(disk).where(eq(disk.alias, alias)).get();
}

function definedFields(identity: DiskIdentity = {}): DiskIdentity {
  return Object.fromEntries(
    Object.entries(identity).filter(
      ([, value]) => value !== undefined && value !== null && value !== "",
    ),
  );
}

function missingFields(row: DiskRow, hints: DiskIdentity): DiskIdentity {
  return Object.fromEntries(
    Object.entries(definedFields(hints)).filter(
      ([field]) => row[field as keyof DiskIdentity] === null,
    ),
  );
}

function hostName(hostId: number | null): string {
  if (hostId === null) return "unknown host";
  return (
    db.select({ name: host.name }).from(host).where(eq(host.id, hostId)).get()
      ?.name ?? "unknown host"
  );
}

function addKeys(diskId: number, keys: DiskKey[]) {
  for (const key of keys) {
    db.insert(diskKey)
      .values({ diskId, ...key })
      .onConflictDoNothing()
      .run();
  }
}

function createDisk(sighting: DiskSighting): DiskRow {
  const created = db
    .insert(disk)
    .values({
      ...definedFields(sighting.identityHints),
      ...definedFields(sighting.identity),
      ...sighting.derive?.(undefined),
      firstSeenAt: sighting.receivedAt,
      lastSeenAt: sighting.receivedAt,
      lastSeenHostId: sighting.hostId,
      lastDevicePath: sighting.devicePath ?? null,
      lastDeviceType: sighting.deviceType ?? null,
    })
    .returning()
    .get();
  addKeys(created.id, sighting.keys);
  addAutoEvent({
    subjectType: "disk",
    subjectId: created.id,
    eventType: "disk-appeared",
    title: `appeared on ${hostName(sighting.hostId)}`,
    data: {
      hostId: sighting.hostId,
      devicePath: sighting.devicePath ?? null,
    },
    at: sighting.receivedAt,
  });
  return created;
}

function sightingUpdate(
  row: DiskRow,
  sighting: DiskSighting,
): Partial<DiskRow> {
  const isLatest =
    row.lastSeenAt === null || sighting.receivedAt >= row.lastSeenAt;
  const firstSeenAt =
    row.firstSeenAt === null || sighting.receivedAt < row.firstSeenAt
      ? sighting.receivedAt
      : row.firstSeenAt;
  if (!isLatest) return { firstSeenAt };
  return {
    firstSeenAt,
    lastSeenAt: sighting.receivedAt,
    lastSeenHostId: sighting.hostId,
    lastDevicePath: sighting.devicePath ?? row.lastDevicePath,
    lastDeviceType: sighting.deviceType ?? row.lastDeviceType,
  };
}

function recordMove(row: DiskRow, sighting: DiskSighting) {
  const moved =
    row.lastSeenHostId !== null &&
    row.lastSeenHostId !== sighting.hostId &&
    (row.lastSeenAt === null || sighting.receivedAt >= row.lastSeenAt);
  if (!moved) return;
  const from = hostName(row.lastSeenHostId);
  const to = hostName(sighting.hostId);
  addAutoEvent({
    subjectType: "disk",
    subjectId: row.id,
    eventType: "moved-host",
    title: `moved from ${from} to ${to}`,
    data: { fromHostId: row.lastSeenHostId, toHostId: sighting.hostId },
    at: sighting.receivedAt,
  });
}

function seenSinceDisposal(row: DiskRow): DisposedDiskSighting | null {
  if (row.disposal === null) return null;
  const seen = latestAutoEvent("disk", row.id, "disposed-disk-seen");
  if (!seen) return null;
  const disposed = latestAutoEvent("disk", row.id, "disposed");
  if (disposed && disposed.at >= seen.at) return null;
  return { at: seen.at, title: seen.title };
}

function recordDisposedDiskSeen(row: DiskRow, sighting: DiskSighting) {
  if (row.disposal === null) return;
  const disposed = latestAutoEvent("disk", row.id, "disposed");
  if (disposed && sighting.receivedAt <= disposed.at) return;
  const seen = latestAutoEvent("disk", row.id, "disposed-disk-seen");
  if (seen && (!disposed || seen.at > disposed.at)) return;
  addAutoEvent({
    subjectType: "disk",
    subjectId: row.id,
    eventType: "disposed-disk-seen",
    title: `seen on ${hostName(sighting.hostId)} while ${disposalTitle(row.disposal)}`,
    data: { hostId: sighting.hostId, disposalOn: row.disposal.on },
    at: sighting.receivedAt,
  });
}

function mergeIntoDisk(row: DiskRow, sighting: DiskSighting): DiskRow {
  addKeys(row.id, sighting.keys);
  recordMove(row, sighting);
  recordDisposedDiskSeen(row, sighting);
  return db
    .update(disk)
    .set({
      ...missingFields(row, sighting.identityHints ?? {}),
      ...definedFields(sighting.identity),
      ...sighting.derive?.(row),
      ...sightingUpdate(row, sighting),
    })
    .where(eq(disk.id, row.id))
    .returning()
    .get();
}

function sameIds(a: unknown, b: number[]) {
  return (
    Array.isArray(a) &&
    a.length === b.length &&
    a.every((id, index) => id === b[index])
  );
}

export function describeDisks(ids: number[]) {
  return db
    .select()
    .from(disk)
    .where(inArray(disk.id, ids))
    .orderBy(asc(disk.id))
    .all()
    .map(describeDisk)
    .join(", ");
}

function recordConflict(
  diskIds: number[],
  keys: DiskKey[],
  receivedAt: Date,
): DiskRow {
  const [olderId] = diskIds;
  const previous = latestAutoEvent("disk", olderId, "identity-conflict");
  if (!sameIds(previous?.data.diskIds, diskIds)) {
    addAutoEvent({
      subjectType: "disk",
      subjectId: olderId,
      eventType: "identity-conflict",
      title: `identity conflict with ${describeDisks(diskIds.slice(1))}`,
      data: { diskIds, keys },
      at: receivedAt,
    });
  }
  return getDiskRow(olderId) as DiskRow;
}

export function observeDisk(sighting: DiskSighting): DiskRow | null {
  try {
    const keys = sighting.keys.filter((key) => key.value !== "");
    if (keys.length === 0) return null;
    const match = matchKeys(keys);
    if (match === null) return createDisk({ ...sighting, keys });
    if ("conflict" in match) {
      return recordConflict(match.conflict, keys, sighting.receivedAt);
    }
    const row = getDiskRow(match.diskId);
    return row ? mergeIntoDisk(row, { ...sighting, keys }) : null;
  } catch (error) {
    console.error("Could not observe disk", sighting.keys, error);
    return null;
  }
}

const SMARTCTL_PROTOCOLS: Record<string, DiskProtocol> = {
  ata: "ata",
  nvme: "nvme",
  scsi: "scsi",
};

function toProtocol(protocol: string): DiskProtocol | undefined {
  if (protocol === "") return undefined;
  return SMARTCTL_PROTOCOLS[protocol.toLowerCase()] ?? "unknown";
}

export function observeDiskFromSmartctl(
  hostId: number,
  meta: IngestMeta,
  parsed: SmartctlXallResult,
  receivedAt: Date,
): DiskRow | null {
  const { identity, device } = parsed;
  const keys = extractKeys({ source: "smartctl-xall", identity });
  const observedIdentity = {
    model: identity.model,
    modelFamily: identity.modelFamily,
    serial: identity.serial,
    firmware: identity.firmware,
    capacityBytes: identity.capacityBytes,
    rotationRate: identity.rotationRate,
    formFactor: identity.formFactor,
    protocol: toProtocol(device.protocol),
    ...hardwareFromSmartctl(parsed),
    scrutinyUuid:
      identity.model && identity.serial
        ? scrutinyUuid(identity.model, identity.serial, identity.wwn)
        : undefined,
  };
  const wwn = keys.find((key) => key.kind === "wwn")?.value;
  return observeDisk({
    hostId,
    receivedAt,
    keys,
    identity: observedIdentity,
    derive: (previous) =>
      deriveHardware(previous, { ...observedIdentity, wwn }),
    devicePath: device.name || meta.device,
    deviceType: meta.type ?? (device.type || undefined),
  });
}

function refreshRecordingTech(row: DiskRow): DiskRow {
  const changes = recordingTechChanges(row);
  if (!changes) return row;
  return db
    .update(disk)
    .set(changes)
    .where(eq(disk.id, row.id))
    .returning()
    .get();
}

function recordZoned(row: DiskRow, zoned: string | null): DiskRow {
  const changes = zonedChanges(row, zoned);
  if (!changes) return refreshRecordingTech(row);
  const updated = db
    .update(disk)
    .set(changes)
    .where(eq(disk.id, row.id))
    .returning()
    .get();
  return refreshRecordingTech(updated);
}

export function observeLsblk(
  hostId: number,
  data: LsblkResult,
  receivedAt: Date,
): DiskRow[] {
  return data.disks.flatMap((lsblkDisk) => {
    const observed = observeDisk({
      hostId,
      receivedAt,
      keys: extractKeys({ source: "lsblk", disk: lsblkDisk }),
      identity: { link: lsblkDisk.link },
      identityHints: {
        ...hardwareHintsFromLsblk(lsblkDisk),
        model: lsblkDisk.model,
        vendor: detectVendor(lsblkDisk),
        serial: lsblkDisk.serial,
        capacityBytes: lsblkDisk.sizeBytes,
      },
      devicePath: lsblkDisk.path,
    });
    if (!observed) return [];
    const zoned = recordZoned(observed, lsblkDisk.zoned);
    return [recordUsage(zoned, inferUsage(lsblkDisk), receivedAt)];
  });
}

function usageChangeTitle(diskId: number, usage: DiskUsage): string {
  switch (usage.kind) {
    case "zfs": {
      const poolName = membershipsOf([diskId]).get(diskId)?.poolName;
      return poolName ? `joined pool ${poolName}` : "zfs label";
    }
    case "filesystem":
      return `formatted ${usage.fsTypes.join(", ")}`;
    default:
      return "wiped";
  }
}

function recordUsageChange(row: DiskRow, usage: DiskUsage, at: Date) {
  const from = row.latestUsage?.kind;
  const to = usage.kind;
  if (from === undefined || from === to) return;
  if (from === "unknown" || to === "unknown") return;
  addAutoEvent({
    subjectType: "disk",
    subjectId: row.id,
    eventType: "usage-changed",
    title: usageChangeTitle(row.id, usage),
    data: { from, to, fsTypes: usage.fsTypes },
    at,
  });
}

function recordUsage(row: DiskRow, usage: DiskUsage, receivedAt: Date) {
  const isLatest = row.lastSeenAt === null || receivedAt >= row.lastSeenAt;
  if (!isLatest) return row;
  recordUsageChange(row, usage, receivedAt);
  return db
    .update(disk)
    .set({ latestUsage: usage })
    .where(eq(disk.id, row.id))
    .returning()
    .get();
}

function recordAliasDrift(
  row: DiskRow,
  alias: string,
  source: AliasSource,
  at: Date,
  holder?: DiskRow,
) {
  const previous = latestAutoEvent("disk", row.id, "alias-drift");
  if (previous?.data.alias === alias) return;
  const heldByDiskId = holder?.id;
  const title = holder
    ? `${source} says ${alias}, already held by ${describeDisk(holder)}`
    : `${source} says ${alias}, stored alias is ${row.alias}`;
  addAutoEvent({
    subjectType: "disk",
    subjectId: row.id,
    eventType: "alias-drift",
    title,
    data: { alias, stored: row.alias, source, heldByDiskId },
    at,
  });
}

export function applyAlias(
  row: DiskRow,
  alias: string,
  source: AliasSource,
  at: Date,
): DiskRow {
  if (row.alias === alias) return row;
  if (row.alias !== null) {
    recordAliasDrift(row, alias, source, at);
    return row;
  }
  const holder = findDiskByAlias(alias);
  if (holder) {
    recordAliasDrift(row, alias, source, at, holder);
    return row;
  }
  addAutoEvent({
    subjectType: "disk",
    subjectId: row.id,
    eventType: "alias-set",
    title: `alias ${alias} from ${source}`,
    data: { alias, source },
    at,
  });
  return db
    .update(disk)
    .set({ alias })
    .where(eq(disk.id, row.id))
    .returning()
    .get();
}

function applyAliasSafely(
  row: DiskRow,
  alias: string,
  source: AliasSource,
  at: Date,
): DiskRow {
  try {
    return applyAlias(row, alias, source, at);
  } catch (error) {
    console.error(`Could not apply ${source} alias ${alias}`, error);
    return row;
  }
}

export function observeUdev(
  hostId: number,
  data: UdevResult,
  receivedAt: Date,
): DiskRow | null {
  const row = observeDisk({
    hostId,
    receivedAt,
    keys: extractKeys({ source: "udev", udev: data }),
    devicePath: data.properties.DEVNAME,
  });
  const alias = data.aliases.find((name) => !isPartitionName(name));
  if (!row || !alias) return row;
  return applyAliasSafely(row, alias, "udev", receivedAt);
}

export interface VdevAliasResolution {
  alias: string;
  target: string;
  diskId: number | null;
}

export function applyVdevIdConf(
  data: VdevIdConfResult,
  receivedAt: Date,
): VdevAliasResolution[] {
  return data.aliases.map(({ alias, target }) => {
    const match = matchKeys(keysFromVdevTarget(target));
    if (match === null || "conflict" in match) {
      return { alias, target, diskId: null };
    }
    const row = getDiskRow(match.diskId);
    if (row) applyAliasSafely(row, alias, "vdev-id-conf", receivedAt);
    return { alias, target, diskId: match.diskId };
  });
}

export function inferState(
  row: Pick<DiskRow, "lastSeenAt">,
  { inPool, present, mounted, now, missingAfterDays }: StateContext,
): DiskState {
  if (row.lastSeenAt === null) return "unseen";
  if (present && (inPool || mounted)) return "in-use";
  if (present) return "spare";
  const absentMs = now.getTime() - row.lastSeenAt.getTime();
  return absentMs <= missingAfterDays * DAY_MS ? "missing" : "removed";
}

export function isPresent(row: Pick<DiskRow, "lastSeenAt">, now: Date) {
  return (
    row.lastSeenAt !== null &&
    now.getTime() - row.lastSeenAt.getTime() <= PRESENT_WINDOW_MS
  );
}

function membershipsOf(diskIds: number[]): Map<number, DiskMembership> {
  if (diskIds.length === 0) return new Map();
  const group = aliasedTable(vdev, "group");
  const rows = db
    .select({
      diskId: vdev.diskId,
      poolId: pool.id,
      poolName: pool.name,
      poolArchived: isNotNull(pool.archivedAt).mapWith(Boolean),
      vdevName: vdev.name,
      groupName: group.name,
      groupType: group.type,
      vdevState: vdev.state,
    })
    .from(vdev)
    .innerJoin(pool, eq(pool.id, vdev.poolId))
    .leftJoin(group, eq(group.id, vdev.parentId))
    .where(and(eq(vdev.present, true), inArray(vdev.diskId, diskIds)))
    .orderBy(isNotNull(pool.archivedAt), asc(vdev.id))
    .all();
  const byDisk = new Map<number, DiskMembership>();
  for (const { diskId, ...membership } of rows) {
    if (diskId !== null && !byDisk.has(diskId)) byDisk.set(diskId, membership);
  }
  return byDisk;
}

function diskIdsInPools(): Set<number> {
  const rows = db
    .selectDistinct({ diskId: vdev.diskId })
    .from(vdev)
    .where(and(eq(vdev.present, true), isNotNull(vdev.diskId)))
    .all();
  return new Set(rows.map((row) => row.diskId as number));
}

function latestReadingIdOf(diskId: typeof disk.id) {
  return db
    .select({ id: smartReading.id })
    .from(smartReading)
    .where(eq(smartReading.diskId, diskId))
    .orderBy(desc(smartReading.takenAt), desc(smartReading.id))
    .limit(1);
}

function latestCounterAttributes(rows: DiskRow[]) {
  const attrIds = new Set(
    rows.flatMap((row) => counterAttributeIds(row.ataSsdAttributes)),
  );
  const latestReadingIds = db
    .select({ id: sql<number>`(${latestReadingIdOf(disk.id)})` })
    .from(disk)
    .where(
      inArray(
        disk.id,
        rows.map((row) => row.id),
      ),
    );
  return db
    .select({
      diskId: smartAttribute.diskId,
      attrId: smartAttribute.attrId,
      value: smartAttribute.value,
      transformedValue: smartAttribute.transformedValue,
      status: smartAttribute.status,
    })
    .from(smartAttribute)
    .where(
      and(
        inArray(smartAttribute.readingId, latestReadingIds),
        inArray(smartAttribute.attrId, [...attrIds]),
      ),
    )
    .all();
}

function activeAcceptancesOf(diskIds: number[]) {
  const rows = db
    .select({
      diskId: faultAcceptance.diskId,
      attrId: faultAcceptance.attrId,
      kind: faultAcceptance.kind,
      acceptedValue: faultAcceptance.acceptedValue,
    })
    .from(faultAcceptance)
    .where(
      and(
        inArray(faultAcceptance.diskId, diskIds),
        isNull(faultAcceptance.supersededAt),
        isNull(faultAcceptance.clearedAt),
      ),
    )
    .orderBy(asc(faultAcceptance.id))
    .all();
  const byDisk = new Map<number, Map<string, AcceptedLevel>>();
  for (const { diskId, attrId, ...level } of rows) {
    const levels = byDisk.get(diskId) ?? new Map<string, AcceptedLevel>();
    levels.set(attrId, level);
    byDisk.set(diskId, levels);
  }
  return byDisk;
}

function countersOf(rows: DiskRow[]): Map<number, DiskCounters> {
  if (rows.length === 0) return new Map();
  const attributesByDisk = Map.groupBy(
    latestCounterAttributes(rows),
    (attribute) => attribute.diskId,
  );
  const acceptances = activeAcceptancesOf(rows.map((row) => row.id));
  return new Map(
    rows.map((row) => [
      row.id,
      countersFrom(
        attributesByDisk.get(row.id) ?? [],
        row.ataSsdAttributes,
        acceptances.get(row.id) ?? new Map(),
      ),
    ]),
  );
}

function replacementsOf(diskIds: number[]): Map<number, number> {
  if (diskIds.length === 0) return new Map();
  const rows = db
    .select({ id: disk.id, replacesDiskId: disk.replacesDiskId })
    .from(disk)
    .where(inArray(disk.replacesDiskId, diskIds))
    .all();
  return new Map(rows.map((row) => [row.replacesDiskId as number, row.id]));
}

function faultCountsOf(diskIds: number[]): Map<number, DiskFaultCounts> {
  if (diskIds.length === 0) return new Map();
  const rows = db
    .select({
      diskId: fault.subjectId,
      state: fault.state,
      severity: fault.severity,
      total: count(),
    })
    .from(fault)
    .where(
      and(
        eq(fault.subjectType, "disk"),
        inArray(fault.subjectId, diskIds),
        inArray(fault.state, LIVE_FAULT_STATES),
      ),
    )
    .groupBy(fault.subjectId, fault.state, fault.severity)
    .all();
  const byDisk = new Map<number, DiskFaultCounts>();
  for (const { diskId, state, severity, total } of rows) {
    const counts = byDisk.get(diskId) ?? { ...NO_DISK_FAULTS };
    const bucket = state === "acknowledged" ? "acknowledged" : severity;
    counts[bucket] += total;
    byDisk.set(diskId, counts);
  }
  return byDisk;
}

interface StateSnapshot {
  inferredState: DiskState;
  state: EffectiveDiskState;
  present: boolean;
  stateAsOf: Date | null;
}

function stateResolver(now: Date, missingAfterDays: number) {
  const inPool = diskIdsInPools();
  const sightingTimes = diskSightingTimes();
  const referenceFor = (row: DiskRow) => {
    const sightedAt =
      row.lastSeenHostId === null
        ? undefined
        : sightingTimes.get(row.lastSeenHostId);
    return sightedAt && sightedAt < now ? sightedAt : now;
  };
  return (row: DiskRow): StateSnapshot => {
    const referenceAt = referenceFor(row);
    const present = isPresent(row, referenceAt);
    const inferredState = inferState(row, {
      inPool: inPool.has(row.id),
      present,
      mounted: isMounted(row.latestUsage ?? UNKNOWN_USAGE),
      now: referenceAt,
      missingAfterDays,
    });
    const isStale =
      row.stateOverride === null &&
      now.getTime() - referenceAt.getTime() > PRESENT_WINDOW_MS;
    return {
      inferredState,
      state: row.stateOverride ?? inferredState,
      present,
      stateAsOf: isStale ? referenceAt : null,
    };
  };
}

function recordStateTransition(
  row: DiskRow,
  state: EffectiveDiskState,
  now: Date,
) {
  if (isDisposed(row) || state === row.lastState) return;
  db.update(disk).set({ lastState: state }).where(eq(disk.id, row.id)).run();
  if (row.lastState === null) return;
  addAutoEvent({
    subjectType: "disk",
    subjectId: row.id,
    eventType: "state-changed",
    title: `${state} (was ${row.lastState})`,
    data: { from: row.lastState, to: state },
    at: now,
  });
}

function isoDay(date: Date) {
  return date.toISOString().slice(0, 10);
}

function daysBetween(fromIsoDay: string, toIsoDay: string) {
  return Math.round((Date.parse(toIsoDay) - Date.parse(fromIsoDay)) / DAY_MS);
}

function inventoryDays(inventory: Partial<Inventory>, now: Date) {
  const today = isoDay(now);
  const warranty = effectiveWarranty(inventory);
  return {
    ageDays: inventory.purchaseDate
      ? daysBetween(inventory.purchaseDate, today)
      : null,
    warrantyDaysLeft: warranty ? daysBetween(today, warranty.expiry) : null,
  };
}

function resolveUsage(row: DiskRow, inPool: boolean) {
  const recorded = row.latestUsage ?? UNKNOWN_USAGE;
  const usage: DiskUsage = inPool ? { ...recorded, kind: "zfs" } : recorded;
  return { usage, ...resolvePurpose(row.inventory, usage) };
}

async function missingAfterDays() {
  return (await getSettings()).config.missingAfterDays;
}

function summarise(
  rows: DiskRow[],
  now: Date,
  resolveState: (row: DiskRow) => StateSnapshot,
): DiskSummary[] {
  const diskIds = rows.map((row) => row.id);
  const keys = keysOf(diskIds);
  const memberships = membershipsOf(diskIds);
  const counters = countersOf(rows);
  const faultCounts = faultCountsOf(diskIds);
  const replacements = replacementsOf(diskIds);
  const bays = baysOf(rows);
  const hosts = new Map(
    db
      .select({
        id: host.id,
        name: host.name,
        temperatureThresholds: host.temperatureThresholds,
      })
      .from(host)
      .all()
      .map((row) => [row.id, row]),
  );
  return rows.map((row) => {
    const snapshot = resolveState(row);
    recordStateTransition(row, snapshot.state, now);
    const {
      latestRaw: _latestRaw,
      latestUsage: _latestUsage,
      ...columns
    } = row;
    const membership = memberships.get(row.id) ?? null;
    const lastHost =
      row.lastSeenHostId === null
        ? null
        : (hosts.get(row.lastSeenHostId) ?? null);
    return {
      ...columns,
      lastState: snapshot.state,
      keys: keys.get(row.id) ?? [],
      membership,
      ...snapshot,
      ...resolveUsage(row, membership !== null),
      hostName: lastHost?.name ?? null,
      replacedByDiskId: replacements.get(row.id) ?? null,
      ...inventoryDays(row.inventory, now),
      sectorFormat: sectorFormat(row.logicalBlockSize, row.physicalBlockSize),
      interfaceLabel: interfaceLabel(row.interface, row.link),
      modelShort: resolveModelShort(row.inventory, row.specs, row.model),
      tempThresholds: resolveTemperatureThresholds(lastHost, row.media),
      counters: counters.get(row.id) ?? NO_COUNTERS,
      faultCounts: faultCounts.get(row.id) ?? NO_DISK_FAULTS,
      bay: bays.get(row.id) ?? null,
    };
  });
}

export async function listDisks(now = new Date()): Promise<DiskSummary[]> {
  const resolveState = stateResolver(now, await missingAfterDays());
  const rows = db
    .select()
    .from(disk)
    .orderBy(sql`${disk.alias} is null`, asc(disk.alias), asc(disk.id))
    .all();
  return summarise(rows, now, resolveState);
}

export async function getDisk(
  id: number,
  now = new Date(),
): Promise<DiskDetail> {
  const row = getDiskRow(id);
  if (!row) throw notFound(`Disk ${id} not found`);
  const resolveState = stateResolver(now, await missingAfterDays());
  const [summary] = summarise([row], now, resolveState);
  return {
    ...summary,
    latestRaw: row.latestRaw,
    diaryCount: countDiary("disk", id),
    seenSinceDisposal: seenSinceDisposal(row),
  };
}

function storageMoveTitle(from: string | null, to: string | null) {
  if (to === null) return `no longer stored at ${from}`;
  return from === null ? `stored at ${to}` : `moved from ${from} to ${to}`;
}

function recordStorageMove(
  row: DiskRow,
  inventory: Partial<Inventory>,
  now: Date,
) {
  const from = row.inventory.storageLocation ?? null;
  const to = inventory.storageLocation ?? null;
  if (from === to) return;
  addAutoEvent({
    subjectType: "disk",
    subjectId: row.id,
    eventType: "moved-storage",
    title: storageMoveTitle(from, to),
    data: { from, to },
    at: now,
  });
}

function mergeInventory(
  current: Partial<Inventory>,
  patch: Partial<Inventory>,
): Partial<Inventory> {
  const merged: Record<string, unknown> = { ...current, ...patch };
  for (const [key, value] of Object.entries(merged)) {
    if (value === null || value === undefined) delete merged[key];
  }
  return merged as Partial<Inventory>;
}

function assertAliasFree(id: number, alias: string) {
  const holder = findDiskByAlias(alias);
  if (holder && holder.id !== id) {
    throw new ServiceError(
      409,
      `Alias ${alias} is already used by ${describeDisk(holder)}`,
    );
  }
}

const DISPOSAL_VERBS: Record<Disposal["kind"], string> = {
  sold: "sold",
  rma: "RMA'd",
  recycled: "recycled",
  "given-away": "given away",
};

function disposalTitle(disposal: Disposal, currency?: string) {
  const price =
    disposal.salePrice !== undefined && currency
      ? ` for ${formatMoney(disposal.salePrice, currency)}`
      : "";
  return `${DISPOSAL_VERBS[disposal.kind]}${price} on ${disposal.on}`;
}

function replacementOf(id: number): DiskRow | undefined {
  return db.select().from(disk).where(eq(disk.replacesDiskId, id)).get();
}

function assertDisposable(row: DiskRow, present: boolean) {
  if (row.disposal !== null || !present) return;
  throw new ServiceError(
    409,
    `${describeDisk(row)} is still attached to ${hostName(row.lastSeenHostId)}`,
  );
}

function replacedDiskFor(id: number, replacesDiskId: number): DiskRow {
  if (replacesDiskId === id) {
    throw new ServiceError(400, "A disk cannot replace itself");
  }
  const replaced = getDiskRow(replacesDiskId);
  if (!replaced) {
    throw new ServiceError(400, "The replaced disk does not exist");
  }
  if (replaced.disposal?.kind !== "rma") {
    throw new ServiceError(409, `${describeDisk(replaced)} was not RMA'd`);
  }
  const replacement = replacementOf(replacesDiskId);
  if (replacement && replacement.id !== id) {
    throw new ServiceError(
      409,
      `${describeDisk(replaced)} is already replaced by ${describeDisk(replacement)}`,
    );
  }
  return replaced;
}

function recordReplacementCleared(
  replaced: DiskRow,
  replacement: DiskRow,
  now: Date,
) {
  addAutoEvent({
    subjectType: "disk",
    subjectId: replaced.id,
    eventType: "replacement-cleared",
    title: `no longer replaced by ${describeDisk(replacement)}`,
    data: { diskId: replacement.id },
    at: now,
  });
  addAutoEvent({
    subjectType: "disk",
    subjectId: replacement.id,
    eventType: "replacement-cleared",
    title: `no longer replaces ${describeDisk(replaced)}`,
    data: { diskId: replaced.id },
    at: now,
  });
}

function recordReplacement(replaced: DiskRow, replacement: DiskRow, now: Date) {
  addAutoEvent({
    subjectType: "disk",
    subjectId: replaced.id,
    eventType: "replaced-by",
    title: `replaced by ${describeDisk(replacement)}`,
    data: { diskId: replacement.id },
    at: now,
  });
  addAutoEvent({
    subjectType: "disk",
    subjectId: replacement.id,
    eventType: "replaces",
    title: `replaces ${describeDisk(replaced)}`,
    data: { diskId: replaced.id },
    at: now,
  });
}

function unlinkReplacementOnDisposalChange(
  row: DiskRow,
  disposal: Disposal | null,
  now: Date,
) {
  if (row.disposal?.kind !== "rma" || disposal?.kind === "rma") return;
  const replacement = replacementOf(row.id);
  if (!replacement) return;
  db.update(disk)
    .set({ replacesDiskId: null })
    .where(eq(disk.id, replacement.id))
    .run();
  recordReplacementCleared(row, replacement, now);
}

function recordDisposal(
  row: DiskRow,
  disposal: Disposal | null,
  currency: string,
  now: Date,
) {
  if (disposal === null) {
    if (row.disposal === null) return;
    addAutoEvent({
      subjectType: "disk",
      subjectId: row.id,
      eventType: "disposal-cleared",
      title: `disposal cleared (was ${disposalTitle(row.disposal, currency)})`,
      data: { from: row.disposal, to: null },
      at: now,
    });
  } else {
    addAutoEvent({
      subjectType: "disk",
      subjectId: row.id,
      eventType: "disposed",
      title: disposalTitle(disposal, currency),
      data: { from: row.disposal, to: disposal },
      at: now,
    });
  }
  unlinkReplacementOnDisposalChange(row, disposal, now);
}

function relinkReplacement(row: DiskRow, replaced: DiskRow | null, now: Date) {
  const previous =
    row.replacesDiskId === null ? undefined : getDiskRow(row.replacesDiskId);
  if (previous) recordReplacementCleared(previous, row, now);
  if (replaced) recordReplacement(replaced, row, now);
}

export async function updateDisk(
  id: number,
  patch: DiskPatch,
  now = new Date(),
): Promise<DiskDetail> {
  const row = getDiskRow(id);
  if (!row) throw notFound(`Disk ${id} not found`);
  const { config } = await getSettings();
  const snapshot = stateResolver(now, config.missingAfterDays)(row);

  const changes: Partial<DiskRow> = {};
  if (patch.alias !== undefined && patch.alias !== row.alias) {
    if (patch.alias !== null) assertAliasFree(id, patch.alias);
    changes.alias = patch.alias;
  }
  if (patch.notes !== undefined) changes.notes = patch.notes;
  if (patch.inventory !== undefined) {
    changes.inventory = mergeInventory(row.inventory, patch.inventory);
  }
  const overrideChanged =
    patch.stateOverride !== undefined &&
    patch.stateOverride !== row.stateOverride;
  const stateOverride = patch.stateOverride ?? null;
  if (overrideChanged) {
    changes.stateOverride = stateOverride;
    changes.lastState = stateOverride ?? snapshot.inferredState;
  }
  const disposal = patch.disposal;
  const disposalChanged =
    disposal !== undefined && (disposal !== null || row.disposal !== null);
  if (disposalChanged) {
    if (disposal !== null) assertDisposable(row, snapshot.present);
    changes.disposal = disposal;
  }
  const replacesDiskId = patch.replacesDiskId;
  const replacementChanged =
    replacesDiskId !== undefined && replacesDiskId !== row.replacesDiskId;
  const replaced =
    replacementChanged && replacesDiskId !== null
      ? replacedDiskFor(id, replacesDiskId)
      : null;
  if (replacementChanged) changes.replacesDiskId = replacesDiskId;

  db.transaction(() => {
    if (overrideChanged) {
      addAutoEvent({
        subjectType: "disk",
        subjectId: id,
        eventType: "override-set",
        title: stateOverride
          ? `state set to ${stateOverride}`
          : `state override cleared (now ${snapshot.inferredState})`,
        data: { from: row.stateOverride, to: stateOverride },
        at: now,
      });
    }
    if (changes.inventory) recordStorageMove(row, changes.inventory, now);
    if (disposalChanged) recordDisposal(row, disposal, config.currency, now);
    if (replacementChanged) relinkReplacement(row, replaced, now);
    if (Object.keys(changes).length === 0) return;
    const updated = db
      .update(disk)
      .set(changes)
      .where(eq(disk.id, id))
      .returning()
      .get();
    if (changes.inventory) refreshRecordingTech(updated);
  });
  return getDisk(id, now);
}
