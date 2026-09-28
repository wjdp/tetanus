import { and, asc, eq, inArray, isNotNull, sql } from "drizzle-orm";
import type {
  DiskKey,
  DiskKeyKind,
  DiskProtocol,
  DiskState,
  EffectiveDiskState,
} from "#shared/disk";
import type { IngestMeta } from "#shared/ingest";
import type { Inventory } from "#shared/inventory-fields";
import type { DiskPatch } from "#shared/schemas/disks";
import { db } from "~~/server/database/client";
import { disk, diskKey, host, vdev } from "~~/server/database/schema";
import type { LsblkResult } from "~~/server/ingest/lsblk";
import type { SmartctlXallResult } from "~~/server/ingest/smartctl-xall";
import type { UdevResult } from "~~/server/ingest/udev";
import type { VdevIdConfResult } from "~~/server/ingest/vdev-id-conf";
import {
  addAutoEvent,
  type DiaryEntryRow,
  latestAutoEvent,
  listDiary,
} from "~~/server/services/diary";
import {
  extractKeys,
  isPartitionName,
  keysFromVdevTarget,
  matchDisks,
  normaliseKey,
  scrutinyUuid,
} from "~~/server/services/identity";
import { getSettings } from "~~/server/services/settings";
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
    | "transport"
    | "formFactor"
  >
>;

export interface DiskSighting {
  hostId: number;
  receivedAt: Date;
  keys: DiskKey[];
  identity?: DiskIdentity;
  identityHints?: DiskIdentity;
  devicePath?: string | null;
  deviceType?: string | null;
}

export type AliasSource = "udev" | "vdev-id-conf";

export interface DiskSummary extends Omit<DiskRow, "latestRaw"> {
  keys: DiskKey[];
  state: EffectiveDiskState;
  inferredState: DiskState;
  hostName: string | null;
  ageDays: number | null;
  warrantyDaysLeft: number | null;
}

export interface DiskDetail extends DiskSummary {
  latestRaw: string | null;
  diary: DiaryEntryRow[];
}

export interface StateContext {
  inPool: boolean;
  present: boolean;
  now: Date;
  missingAfterDays: number;
}

export const PRESENT_WINDOW_MS = 2 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

function getDiskRow(id: number): DiskRow | undefined {
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

function matchKeys(keys: DiskKey[]) {
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
      ?.name ?? `host ${hostId}`
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
      firstSeenAt: sighting.receivedAt,
      lastSeenAt: sighting.receivedAt,
      lastSeenHostId: sighting.hostId,
      lastDevicePath: sighting.devicePath ?? null,
      lastDeviceType: sighting.deviceType ?? null,
    })
    .returning()
    .get();
  addKeys(created.id, sighting.keys);
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

function mergeIntoDisk(row: DiskRow, sighting: DiskSighting): DiskRow {
  addKeys(row.id, sighting.keys);
  recordMove(row, sighting);
  return db
    .update(disk)
    .set({
      ...missingFields(row, sighting.identityHints ?? {}),
      ...definedFields(sighting.identity),
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
      title: `identity conflict with disk ${diskIds.slice(1).join(", ")}`,
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
  return observeDisk({
    hostId,
    receivedAt,
    keys: extractKeys({ source: "smartctl-xall", identity }),
    identity: {
      model: identity.model,
      modelFamily: identity.modelFamily,
      serial: identity.serial,
      firmware: identity.firmware,
      capacityBytes: identity.capacityBytes,
      rotationRate: identity.rotationRate,
      formFactor: identity.formFactor,
      protocol: toProtocol(device.protocol),
      scrutinyUuid:
        identity.model && identity.serial
          ? scrutinyUuid(identity.model, identity.serial, identity.wwn)
          : undefined,
    },
    devicePath: device.name || meta.device,
    deviceType: meta.type ?? (device.type || undefined),
  });
}

export function observeLsblk(
  hostId: number,
  data: LsblkResult,
  receivedAt: Date,
): DiskRow[] {
  return data.disks.flatMap((lsblkDisk) => {
    const row = observeDisk({
      hostId,
      receivedAt,
      keys: extractKeys({ source: "lsblk", disk: lsblkDisk }),
      identity: { transport: lsblkDisk.transport },
      identityHints: {
        model: lsblkDisk.model,
        serial: lsblkDisk.serial,
        capacityBytes: lsblkDisk.sizeBytes,
      },
      devicePath: lsblkDisk.path,
    });
    return row ? [row] : [];
  });
}

function recordAliasDrift(
  row: DiskRow,
  alias: string,
  source: AliasSource,
  at: Date,
  heldByDiskId?: number,
) {
  const previous = latestAutoEvent("disk", row.id, "alias-drift");
  if (previous?.data.alias === alias) return;
  const title = heldByDiskId
    ? `${source} says ${alias}, already held by disk ${heldByDiskId}`
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
    recordAliasDrift(row, alias, source, at, holder.id);
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
  { inPool, present, now, missingAfterDays }: StateContext,
): DiskState {
  if (row.lastSeenAt === null) return "unseen";
  if (present && inPool) return "in-use";
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

function diskIdsInPools(): Set<number> {
  const rows = db
    .selectDistinct({ diskId: vdev.diskId })
    .from(vdev)
    .where(and(eq(vdev.present, true), isNotNull(vdev.diskId)))
    .all();
  return new Set(rows.map((row) => row.diskId as number));
}

interface StateSnapshot {
  inferredState: DiskState;
  state: EffectiveDiskState;
}

function stateResolver(now: Date, missingAfterDays: number) {
  const inPool = diskIdsInPools();
  return (row: DiskRow): StateSnapshot => {
    const inferredState = inferState(row, {
      inPool: inPool.has(row.id),
      present: isPresent(row, now),
      now,
      missingAfterDays,
    });
    return { inferredState, state: row.stateOverride ?? inferredState };
  };
}

function recordStateTransition(
  row: DiskRow,
  state: EffectiveDiskState,
  now: Date,
) {
  if (state === row.lastState) return;
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
  return {
    ageDays: inventory.purchaseDate
      ? daysBetween(inventory.purchaseDate, today)
      : null,
    warrantyDaysLeft: inventory.warrantyExpiry
      ? daysBetween(today, inventory.warrantyExpiry)
      : null,
  };
}

async function missingAfterDays() {
  return (await getSettings()).config.missingAfterDays;
}

function summarise(
  rows: DiskRow[],
  now: Date,
  resolveState: (row: DiskRow) => StateSnapshot,
): DiskSummary[] {
  const keys = keysOf(rows.map((row) => row.id));
  const hostNames = new Map(
    db
      .select({ id: host.id, name: host.name })
      .from(host)
      .all()
      .map((row) => [row.id, row.name]),
  );
  return rows.map((row) => {
    const snapshot = resolveState(row);
    recordStateTransition(row, snapshot.state, now);
    const { latestRaw: _latestRaw, ...columns } = row;
    return {
      ...columns,
      lastState: snapshot.state,
      keys: keys.get(row.id) ?? [],
      ...snapshot,
      hostName:
        row.lastSeenHostId === null
          ? null
          : (hostNames.get(row.lastSeenHostId) ?? null),
      ...inventoryDays(row.inventory, now),
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
    diary: listDiary({ subjectType: "disk", subjectId: id }),
  };
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
      `Alias ${alias} is already used by disk ${holder.id}`,
    );
  }
}

export async function updateDisk(
  id: number,
  patch: DiskPatch,
  now = new Date(),
): Promise<DiskDetail> {
  const row = getDiskRow(id);
  if (!row) throw notFound(`Disk ${id} not found`);

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
  if (overrideChanged) {
    const stateOverride = patch.stateOverride ?? null;
    const { inferredState } = stateResolver(now, await missingAfterDays())(row);
    changes.stateOverride = stateOverride;
    changes.lastState = stateOverride ?? inferredState;
    addAutoEvent({
      subjectType: "disk",
      subjectId: id,
      eventType: "override-set",
      title: stateOverride
        ? `state set to ${stateOverride}`
        : `state override cleared (now ${inferredState})`,
      data: { from: row.stateOverride, to: stateOverride },
      at: now,
    });
  }

  if (Object.keys(changes).length > 0) {
    db.update(disk).set(changes).where(eq(disk.id, id)).run();
  }
  return getDisk(id, now);
}
