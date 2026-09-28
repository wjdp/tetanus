import { and, asc, desc, eq, gte, lte } from "drizzle-orm";
import type { DiskProtocol } from "#shared/disk";
import type { IngestMeta } from "#shared/ingest";
import type { SmartHistoryRange } from "#shared/schemas/smart";
import {
  type EvaluatedAttribute,
  evaluateReading,
} from "#shared/smart/evaluate";
import {
  type AttributeIdeal,
  attributeMetadata,
  type SmartProtocol,
} from "#shared/smart/metadata";
import type { DeviceStatus } from "#shared/smart/status";
import type {
  SctTemperatureHistory,
  SelfTestEntry,
  SmartctlXallResult,
} from "#shared/smartctl";
import { db } from "~~/server/database/client";
import {
  disk,
  selfTest,
  smartAttribute,
  smartReading,
  temperatureReading,
} from "~~/server/database/schema";
import { addAutoEvent } from "~~/server/services/diary";
import type { DiskRow } from "~~/server/services/disks";
import { notFound } from "~~/server/utils/serviceError";

export type SmartReadingRow = typeof smartReading.$inferSelect;
export type SmartAttributeRow = typeof smartAttribute.$inferSelect;

export interface SmartReadingInput {
  disk: DiskRow;
  hostId: number;
  meta: IngestMeta;
  parsed: SmartctlXallResult;
  body: string;
  receivedAt: Date;
}

export type AttributeTrend = "new" | "stable" | "worsening" | "improving";

export interface AttributeMetadataSummary {
  displayName: string;
  ideal: AttributeIdeal;
  critical: boolean;
  description: string;
  transformValueUnit?: string;
}

export interface LatestAttribute
  extends Omit<SmartAttributeRow, "id" | "readingId" | "diskId"> {
  trend: AttributeTrend;
  metadata: AttributeMetadataSummary | null;
}

export interface TemperaturePoint {
  at: Date;
  celsius: number;
}

export interface AttributePoint {
  at: Date;
  value: number;
}

export interface SmartHistory {
  temperature: TemperaturePoint[];
  attributes: Record<string, AttributePoint[]>;
}

export interface SmartOverview {
  reading: SmartReadingRow | null;
  attributes: LatestAttribute[];
  history: SmartHistory;
}

export const MAX_HISTORY_POINTS = 500;
const MINUTE_MS = 60 * 1000;
const DAY_MS = 24 * 60 * MINUTE_MS;
const TREND_WINDOWS_DAYS = [7, 30] as const;

const RANGE_DAYS: Record<SmartHistoryRange, number | null> = {
  "7d": 7,
  "30d": 30,
  "1y": 365,
  all: null,
};

const PROTOCOLS: Partial<Record<DiskProtocol, SmartProtocol>> = {
  ata: "ATA",
  nvme: "NVMe",
  scsi: "SCSI",
};

function isSmartProtocol(protocol: string): protocol is SmartProtocol {
  return protocol === "ATA" || protocol === "NVMe" || protocol === "SCSI";
}

function metadataFor(protocol: SmartProtocol | undefined, attrId: string) {
  if (protocol) return attributeMetadata(protocol, attrId);
  return /^\d+$/.test(attrId) ? attributeMetadata("ATA", attrId) : undefined;
}

function attributeName(
  protocol: SmartProtocol | undefined,
  attribute: EvaluatedAttribute,
) {
  if (protocol !== "ATA") return attribute.name;
  return (
    attributeMetadata("ATA", attribute.attrId)?.displayName ?? attribute.name
  );
}

function presentTemperature(celsius: number | null | undefined) {
  return typeof celsius === "number" && celsius > 0 ? celsius : null;
}

export function sctTemperaturePoints(
  history: SctTemperatureHistory | undefined,
  receivedAt: Date,
): TemperaturePoint[] {
  if (!history?.intervalMinutes || history.intervalMinutes <= 0) return [];
  const intervalMs = history.intervalMinutes * MINUTE_MS;
  const newestIndex = history.values.length - 1;
  return history.values.flatMap((value, index) => {
    const celsius = presentTemperature(value);
    if (celsius === null) return [];
    const unaligned = receivedAt.getTime() - (newestIndex - index) * intervalMs;
    const at = new Date(Math.floor(unaligned / intervalMs) * intervalMs);
    return [{ at, celsius }];
  });
}

function insertTemperatures(diskId: number, points: TemperaturePoint[]) {
  for (const point of points) {
    db.insert(temperatureReading)
      .values({ diskId, ...point })
      .onConflictDoNothing()
      .run();
  }
}

function upsertSelfTests(
  diskId: number,
  entries: SelfTestEntry[] = [],
  seenAt: Date,
) {
  for (const entry of entries) {
    if (entry.type === undefined || entry.lifetimeHours === undefined) continue;
    const outcome = {
      status: entry.status ?? "",
      passed: entry.passed,
      lba: entry.lba ?? null,
    };
    db.insert(selfTest)
      .values({
        diskId,
        type: entry.type,
        lifetimeHours: entry.lifetimeHours,
        seenAt,
        ...outcome,
      })
      .onConflictDoUpdate({
        target: [selfTest.diskId, selfTest.type, selfTest.lifetimeHours],
        set: outcome,
      })
      .run();
  }
}

function attributeIdsWithStatus(
  attributes: EvaluatedAttribute[],
  status: EvaluatedAttribute["status"],
) {
  return attributes
    .filter((attribute) => attribute.status === status)
    .map((attribute) => attribute.attrId);
}

function recordStatusChange(
  row: DiskRow,
  to: DeviceStatus,
  attributes: EvaluatedAttribute[],
  at: Date,
) {
  const from = row.latestStatus;
  if (row.latestReadingAt === null || from === to) return;
  addAutoEvent({
    subjectType: "disk",
    subjectId: row.id,
    eventType: "smart-status-changed",
    title: `${to} (was ${from})`,
    data: {
      from,
      to,
      failing: attributeIdsWithStatus(attributes, "failed"),
      warning: attributeIdsWithStatus(attributes, "warning"),
    },
    at,
  });
}

export function recordSmartReading({
  disk: row,
  hostId,
  meta,
  parsed,
  body,
  receivedAt,
}: SmartReadingInput): SmartReadingRow | null {
  if (parsed.standby) return null;

  const protocol = isSmartProtocol(parsed.device.protocol)
    ? parsed.device.protocol
    : undefined;
  const { deviceStatus, attributes } = evaluateReading(parsed);
  const temp = presentTemperature(parsed.temperature);

  const reading = db
    .insert(smartReading)
    .values({
      diskId: row.id,
      hostId,
      takenAt: receivedAt,
      devicePath: parsed.device.name || meta.device || "",
      deviceType: meta.type ?? (parsed.device.type || null),
      smartPassed: parsed.smartStatus?.passed ?? null,
      exitStatus: parsed.smartctl.exitStatus.raw,
      temp,
      powerOnHours: parsed.powerOnHours ?? null,
      powerCycles: parsed.powerCycles ?? null,
      deviceStatus,
    })
    .returning()
    .get();

  for (const attribute of attributes) {
    db.insert(smartAttribute)
      .values({
        readingId: reading.id,
        diskId: row.id,
        takenAt: receivedAt,
        attrId: attribute.attrId,
        name: attributeName(protocol, attribute),
        value: attribute.value,
        worst: attribute.worst ?? null,
        thresh: attribute.thresh ?? null,
        rawValue: attribute.rawValue ?? null,
        rawString: attribute.rawString ?? null,
        whenFailed: attribute.whenFailed ?? null,
        transformedValue: attribute.transformedValue,
        status: attribute.status,
        failureRate: attribute.failureRate ?? null,
        reason: attribute.reason ?? null,
      })
      .run();
  }

  insertTemperatures(row.id, [
    ...(temp === null ? [] : [{ at: receivedAt, celsius: temp }]),
    ...sctTemperaturePoints(parsed.sctTemperatureHistory, receivedAt),
  ]);
  upsertSelfTests(row.id, parsed.selfTests, receivedAt);

  const isLatest =
    row.latestReadingAt === null || receivedAt >= row.latestReadingAt;
  if (isLatest) {
    recordStatusChange(row, deviceStatus, attributes, receivedAt);
    db.update(disk)
      .set({
        latestRaw: body,
        latestStatus: deviceStatus,
        latestTemp: temp,
        latestPowerOnHours: reading.powerOnHours,
        latestPowerCycles: reading.powerCycles,
        latestReadingAt: receivedAt,
      })
      .where(eq(disk.id, row.id))
      .run();
  }

  return reading;
}

export function downsample<T extends { at: Date }>(
  points: T[],
  maxPoints = MAX_HISTORY_POINTS,
): T[] {
  if (points.length <= maxPoints) return points;
  const start = points[0].at.getTime();
  const span = points[points.length - 1].at.getTime() - start;
  if (span <= 0) return points.slice(-1);
  const bucketOf = (point: T) =>
    Math.min(
      maxPoints - 1,
      Math.floor(((point.at.getTime() - start) / span) * maxPoints),
    );
  const lastPerBucket = new Map<number, T>();
  for (const point of points) lastPerBucket.set(bucketOf(point), point);
  return [...lastPerBucket.values()];
}

function assertDiskExists(diskId: number) {
  const found = db
    .select({ id: disk.id })
    .from(disk)
    .where(eq(disk.id, diskId))
    .get();
  if (!found) throw notFound(`Disk ${diskId} not found`);
}

function rangeStart(range: SmartHistoryRange, now: Date) {
  const days = RANGE_DAYS[range];
  return new Date(days === null ? 0 : now.getTime() - days * DAY_MS);
}

export function getSmartHistory(
  diskId: number,
  range: SmartHistoryRange,
  now = new Date(),
): SmartHistory {
  assertDiskExists(diskId);
  const since = rangeStart(range, now);

  const temperature = db
    .select({ at: temperatureReading.at, celsius: temperatureReading.celsius })
    .from(temperatureReading)
    .where(
      and(
        eq(temperatureReading.diskId, diskId),
        gte(temperatureReading.at, since),
      ),
    )
    .orderBy(asc(temperatureReading.at))
    .all();

  const attributeRows = db
    .select({
      attrId: smartAttribute.attrId,
      at: smartAttribute.takenAt,
      value: smartAttribute.transformedValue,
    })
    .from(smartAttribute)
    .where(
      and(
        eq(smartAttribute.diskId, diskId),
        gte(smartAttribute.takenAt, since),
      ),
    )
    .orderBy(asc(smartAttribute.takenAt), asc(smartAttribute.id))
    .all();

  const series = new Map<string, AttributePoint[]>();
  for (const { attrId, at, value } of attributeRows) {
    const points = series.get(attrId) ?? [];
    points.push({ at, value });
    series.set(attrId, points);
  }

  return {
    temperature: downsample(temperature),
    attributes: Object.fromEntries(
      [...series].map(([attrId, points]) => [attrId, downsample(points)]),
    ),
  };
}

export function trendDirection(
  ideal: AttributeIdeal,
  current: number,
  references: number[],
): AttributeTrend {
  if (references.length === 0) return "new";
  if (ideal === "") return "stable";
  const isWorse = (reference: number) =>
    ideal === "low" ? current > reference : current < reference;
  const isBetter = (reference: number) =>
    ideal === "low" ? current < reference : current > reference;
  if (references.some(isWorse)) return "worsening";
  if (references.some(isBetter)) return "improving";
  return "stable";
}

function referenceValues(diskId: number, attrId: string, takenAt: Date) {
  return TREND_WINDOWS_DAYS.flatMap((days) => {
    const cutoff = new Date(takenAt.getTime() - days * DAY_MS);
    const reference = db
      .select({ value: smartAttribute.transformedValue })
      .from(smartAttribute)
      .where(
        and(
          eq(smartAttribute.diskId, diskId),
          eq(smartAttribute.attrId, attrId),
          lte(smartAttribute.takenAt, cutoff),
        ),
      )
      .orderBy(desc(smartAttribute.takenAt), desc(smartAttribute.id))
      .limit(1)
      .get();
    return reference ? [reference.value] : [];
  });
}

function summariseMetadata(
  protocol: SmartProtocol | undefined,
  attrId: string,
): AttributeMetadataSummary | null {
  const metadata = metadataFor(protocol, attrId);
  if (!metadata) return null;
  const { displayName, ideal, critical, description } = metadata;
  const unit =
    "transformValueUnit" in metadata &&
    typeof metadata.transformValueUnit === "string"
      ? { transformValueUnit: metadata.transformValueUnit }
      : {};
  return { displayName, ideal, critical, description, ...unit };
}

export function latestReading(diskId: number): SmartReadingRow | null {
  return (
    db
      .select()
      .from(smartReading)
      .where(eq(smartReading.diskId, diskId))
      .orderBy(desc(smartReading.takenAt), desc(smartReading.id))
      .limit(1)
      .get() ?? null
  );
}

function diskProtocol(diskId: number): SmartProtocol | undefined {
  const row = db
    .select({ protocol: disk.protocol })
    .from(disk)
    .where(eq(disk.id, diskId))
    .get();
  return row?.protocol ? PROTOCOLS[row.protocol] : undefined;
}

export function latestAttributes(diskId: number): LatestAttribute[] {
  const reading = latestReading(diskId);
  if (!reading) return [];
  const protocol = diskProtocol(diskId);
  const rows = db
    .select()
    .from(smartAttribute)
    .where(eq(smartAttribute.readingId, reading.id))
    .orderBy(asc(smartAttribute.id))
    .all();
  return rows.map(({ id: _id, readingId: _readingId, ...attribute }) => {
    const metadata = summariseMetadata(protocol, attribute.attrId);
    const { diskId: _diskId, ...columns } = attribute;
    return {
      ...columns,
      trend: trendDirection(
        metadata?.ideal ?? "",
        attribute.transformedValue,
        referenceValues(diskId, attribute.attrId, attribute.takenAt),
      ),
      metadata,
    };
  });
}

export function getSmartOverview(
  diskId: number,
  range: SmartHistoryRange,
  now = new Date(),
): SmartOverview {
  assertDiskExists(diskId);
  return {
    reading: latestReading(diskId),
    attributes: latestAttributes(diskId),
    history: getSmartHistory(diskId, range, now),
  };
}
