import { and, asc, desc, eq, gt, gte, lte, ne } from "drizzle-orm";
import type { DiskProtocol } from "#shared/disk";
import type { IngestMeta } from "#shared/ingest";
import { FULL_TEMPERATURE_DAYS } from "#shared/retention";
import type { SmartHistoryRange } from "#shared/schemas/smart";
import {
  type AtaSsdAttributes,
  ataSsdAttributesFrom,
} from "#shared/smart/ataSsdAttributes";
import type { DeviceStatistics } from "#shared/smart/deviceStatistics";
import {
  type EvaluatedAttribute,
  evaluateReading,
} from "#shared/smart/evaluate";
import {
  type AttributeIdeal,
  attributeMetadata,
  type SmartProtocol,
} from "#shared/smart/metadata";
import {
  applySsdPolicy,
  DEFECT_RISE_WINDOW_DAYS,
  NO_SSD_CONTEXT,
  type SsdPolicyContext,
} from "#shared/smart/ssdPolicy";
import {
  ATTRIBUTE_STATUSES,
  type AttributeDisplayStatus,
  type AttributeStatus,
  type DeviceStatus,
  effectiveDeviceStatus,
  healthStatus,
  overlayStatus,
} from "#shared/smart/status";
import type {
  AtaAttribute,
  ScsiInfo,
  SctTemperatureHistory,
  SelfTestEntry,
  SmartctlXallResult,
} from "#shared/smartctl";
import { effectiveVendor } from "#shared/vendor";
import { db } from "~~/server/database/client";
import {
  diaryEntry,
  disk,
  selfTest,
  smartAttribute,
  smartReading,
  temperatureReading,
} from "~~/server/database/schema";
import {
  activeAcceptances,
  type FaultAcceptanceRow,
  listAcceptances,
  supersedeIfRisen,
} from "~~/server/services/acceptance";
import { addAutoEvent } from "~~/server/services/diary";
import type { DiskRow } from "~~/server/services/disks";
import { notFound } from "~~/server/utils/serviceError";

export type SmartReadingRow = typeof smartReading.$inferSelect;
export type SmartAttributeRow = typeof smartAttribute.$inferSelect;
export type SelfTestRow = typeof selfTest.$inferSelect;

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

export type AttributeAcceptance = Pick<
  FaultAcceptanceRow,
  "id" | "kind" | "acceptedValue" | "acceptedAt" | "note"
>;

export interface LatestAttribute
  extends Omit<SmartAttributeRow, "id" | "readingId" | "diskId"> {
  trend: AttributeTrend;
  metadata: AttributeMetadataSummary | null;
  displayStatus: AttributeDisplayStatus;
  acceptance: AttributeAcceptance | null;
  statusChanges: AttributeStatusChange[];
  statusSince: Date | null;
  valueSince: Date;
  firstNonZeroAt: Date | null;
}

export interface AttributeStatusChange {
  at: Date;
  from: AttributeStatus;
  to: AttributeStatus;
  value: number;
}

export interface TemperaturePoint {
  at: Date;
  celsius: number;
}

export type SmartReadingSource = SmartReadingRow["source"];

export interface AttributePoint {
  at: Date;
  value: number;
  source?: Exclude<SmartReadingSource, "collector">;
}

export interface SmartHistory {
  temperature: TemperaturePoint[];
  attributes: Record<string, AttributePoint[]>;
  importedUntil: Date | null;
}

export interface SmartOverview {
  reading: SmartReadingRow | null;
  attributes: LatestAttribute[];
  history: SmartHistory;
  selfTests: SelfTestRow[];
  acceptances: FaultAcceptanceRow[];
}

export const MAX_HISTORY_POINTS = 500;
const MINUTE_MS = 60 * 1000;
const DAY_MS = 24 * 60 * MINUTE_MS;
const TREND_WINDOWS_DAYS = [7, 30] as const;
const MAX_STATUS_CHANGES = 5;

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

/** Older points would land in hours retention has already collapsed. */
export function sctTemperaturePoints(
  history: SctTemperatureHistory | undefined,
  receivedAt: Date,
): TemperaturePoint[] {
  if (!history?.intervalMinutes || history.intervalMinutes <= 0) return [];
  const intervalMs = history.intervalMinutes * MINUTE_MS;
  const newestIndex = history.values.length - 1;
  const oldest = receivedAt.getTime() - FULL_TEMPERATURE_DAYS * DAY_MS;
  return history.values.flatMap((value, index) => {
    const celsius = presentTemperature(value);
    if (celsius === null) return [];
    const unaligned = receivedAt.getTime() - (newestIndex - index) * intervalMs;
    if (unaligned < oldest) return [];
    const at = new Date(Math.floor(unaligned / intervalMs) * intervalMs);
    return [{ at, celsius }];
  });
}

// Durable Object SQLite allows only 100 bound parameters per statement.
const MAX_BOUND_PARAMETERS = 100;

function* chunked<T>(rows: T[], columnsPerRow: number) {
  const size = Math.floor(MAX_BOUND_PARAMETERS / columnsPerRow);
  for (let start = 0; start < rows.length; start += size) {
    yield rows.slice(start, start + size);
  }
}

export function insertTemperatures(diskId: number, points: TemperaturePoint[]) {
  for (const chunk of chunked(points, 3)) {
    db.insert(temperatureReading)
      .values(chunk.map((point) => ({ diskId, ...point })))
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

type StoredAttribute = Pick<
  SmartAttributeRow,
  "attrId" | "name" | "status" | "transformedValue"
>;

function attributeIdsWithStatus(
  attributes: StoredAttribute[],
  active: ReadonlyMap<string, FaultAcceptanceRow>,
  status: AttributeDisplayStatus,
) {
  return attributes
    .filter(
      (attribute) =>
        overlayStatus(
          attribute.status,
          attribute.transformedValue,
          active.get(attribute.attrId),
        ) === status,
    )
    .map((attribute) => attribute.attrId);
}

export type StatusChangeCause = "reading" | "acceptance" | "policy";

interface StatusChangeContext {
  cause: StatusChangeCause;
  superseded?: ReadonlySet<string>;
}

function recordStatusChange(
  row: Pick<DiskRow, "id" | "latestStatus" | "latestReadingAt">,
  to: DeviceStatus,
  attributes: StoredAttribute[],
  active: ReadonlyMap<string, FaultAcceptanceRow>,
  at: Date,
  { cause, superseded = new Set() }: StatusChangeContext,
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
      failing: attributeIdsWithStatus(attributes, active, "failed"),
      warning: attributeIdsWithStatus(attributes, active, "warning"),
      acknowledged: attributeIdsWithStatus(attributes, active, "acknowledged"),
      superseded: [...superseded],
      cause,
    },
    at,
  });
}

export function attributesOfReading(readingId: number): SmartAttributeRow[] {
  return db
    .select()
    .from(smartAttribute)
    .where(eq(smartAttribute.readingId, readingId))
    .orderBy(asc(smartAttribute.id))
    .all();
}

function recordAttributeStatusChanges(
  diskId: number,
  previous: StoredAttribute[],
  current: StoredAttribute[],
  at: Date,
  superseded: ReadonlySet<string>,
) {
  const previousByAttr = new Map(
    previous.map((attribute) => [attribute.attrId, attribute]),
  );
  for (const attribute of current) {
    const before = previousByAttr.get(attribute.attrId);
    if (!before || before.status === attribute.status) continue;
    addAutoEvent({
      subjectType: "disk",
      subjectId: diskId,
      eventType: "attribute-status-changed",
      title: `${attribute.name} ${attribute.status} (was ${before.status})`,
      data: {
        attrId: attribute.attrId,
        name: attribute.name,
        from: before.status,
        to: attribute.status,
        value: attribute.transformedValue,
        superseded: superseded.has(attribute.attrId),
      },
      at,
    });
  }
}

export function ssdPolicyContext(
  ataSsdAttributes: AtaSsdAttributes | null,
  deviceStatistics: DeviceStatistics | null | undefined,
  risenAttrIds: ReadonlySet<string> = new Set(),
): SsdPolicyContext {
  const percentageUsed = deviceStatistics?.percentageUsed;
  return {
    ataSsdAttributes,
    percentageUsed:
      typeof percentageUsed === "number" &&
      !deviceStatistics?.normalised.includes("percentageUsed")
        ? percentageUsed
        : null,
    risenAttrIds,
  };
}

export function risenDefects(
  diskId: number,
  ataSsdAttributes: AtaSsdAttributes | null,
  at: Date,
  pending: ReadonlyMap<string, number> = new Map(),
): Set<string> {
  return new Set(
    (ataSsdAttributes?.defects ?? []).filter((attrId) => {
      const series = attributeSeries(
        diskId,
        attrId,
        at,
        DEFECT_RISE_WINDOW_DAYS,
      );
      const value = pending.get(attrId);
      return riseOf(value === undefined ? series : [...series, value]).risen;
    }),
  );
}

export function evaluateNamedAttributes(
  parsed: SmartctlXallResult,
  context: SsdPolicyContext = NO_SSD_CONTEXT,
): EvaluatedAttribute[] {
  const protocol = isSmartProtocol(parsed.device.protocol)
    ? parsed.device.protocol
    : undefined;
  return applySsdPolicy(evaluateReading(parsed).attributes, context).map(
    (attribute) => ({
      ...attribute,
      name: attributeName(protocol, attribute),
    }),
  );
}

export interface MinimalSmartAttribute {
  id: string;
  value: number;
  worst?: number | null;
  thresh?: number | null;
  rawValue?: number | null;
  rawString?: string | null;
  whenFailed?: string | null;
}

export interface MinimalSmartReading {
  protocol: SmartProtocol;
  attributes: MinimalSmartAttribute[];
  temperature?: number | null;
  powerOnHours?: number | null;
  powerCycles?: number | null;
}

export interface MinimalEvaluation {
  attributes: EvaluatedAttribute[];
  deviceStatus: DeviceStatus;
  temp: number | null;
}

const NO_ATA_FLAGS = {
  prefailure: false,
  updatedOnline: false,
  performance: false,
  errorRate: false,
  eventCount: false,
  autoKeep: false,
};

const NO_EXIT_FLAGS = {
  raw: 0,
  commandLineError: false,
  deviceOpenFailed: false,
  commandFailed: false,
  diskFailing: false,
  prefailBelowThreshold: false,
  pastPrefailBelowThreshold: false,
  errorLogHasErrors: false,
  selfTestLogHasErrors: false,
};

const SCSI_DIRECTION = /^(read|write)_(.+)$/;

function camelCase(snake: string) {
  return snake.replace(/_([a-z])/g, (_match, letter: string) =>
    letter.toUpperCase(),
  );
}

function optional<T>(value: T | null | undefined): T | undefined {
  return value ?? undefined;
}

function ataAttributes(attributes: MinimalSmartAttribute[]): AtaAttribute[] {
  return attributes.flatMap((attribute) => {
    if (!/^\d+$/.test(attribute.id)) return [];
    return [
      {
        id: Number(attribute.id),
        name: `Attribute_${attribute.id}`,
        value: attribute.value,
        worst: attribute.worst ?? attribute.value,
        thresh: attribute.thresh ?? 0,
        whenFailed: attribute.whenFailed || null,
        raw: {
          value: optional(attribute.rawValue),
          string: optional(attribute.rawString),
        },
        flags: NO_ATA_FLAGS,
      },
    ];
  });
}

function nvmeLog(attributes: MinimalSmartAttribute[]) {
  const log: Record<string, unknown> = {};
  for (const attribute of attributes) {
    log[camelCase(attribute.id)] = attribute.value;
    if (attribute.id === "available_spare" && attribute.thresh != null) {
      log.availableSpareThreshold = attribute.thresh;
    }
  }
  return log;
}

function scsiInfo(attributes: MinimalSmartAttribute[]): ScsiInfo {
  const info: ScsiInfo = {};
  for (const attribute of attributes) {
    if (attribute.id === "scsi_grown_defect_list") {
      info.grownDefects = attribute.value;
      continue;
    }
    const direction = SCSI_DIRECTION.exec(attribute.id);
    if (!direction) continue;
    const side = direction[1] as "read" | "write";
    info[side] = { ...info[side], [camelCase(direction[2])]: attribute.value };
  }
  return info;
}

export function parsedFromMinimal(
  reading: MinimalSmartReading,
): SmartctlXallResult {
  return {
    device: { name: "", type: "", protocol: reading.protocol },
    smartctl: { version: "", exitStatus: NO_EXIT_FLAGS },
    identity: {},
    smartSupport: { available: true, enabled: true },
    standby: false,
    temperature: optional(reading.temperature),
    powerOnHours: optional(reading.powerOnHours),
    powerCycles: optional(reading.powerCycles),
    ...(reading.protocol === "ATA"
      ? { ata: { attributes: ataAttributes(reading.attributes) } }
      : {}),
    ...(reading.protocol === "NVMe"
      ? { nvme: nvmeLog(reading.attributes) }
      : {}),
    ...(reading.protocol === "SCSI"
      ? { scsi: scsiInfo(reading.attributes) }
      : {}),
  };
}

// For readings from other tools: no overall SMART verdict, no acceptances,
// so the status is the worst attribute status under our own policy.
export function evaluateMinimalReading(
  reading: MinimalSmartReading,
): MinimalEvaluation {
  const parsed = parsedFromMinimal(reading);
  const attributes = evaluateNamedAttributes(parsed);
  return {
    attributes,
    deviceStatus: effectiveDeviceStatus(
      healthStatus(null, null),
      attributes,
      new Map(),
    ),
    temp: presentTemperature(parsed.temperature),
  };
}

export type SmartReadingValues = Omit<typeof smartReading.$inferInsert, "id">;

export function insertSmartReading(
  values: SmartReadingValues,
  attributes: EvaluatedAttribute[],
): SmartReadingRow {
  const reading = db.insert(smartReading).values(values).returning().get();
  for (const chunk of chunked(attributes, 15)) {
    db.insert(smartAttribute)
      .values(
        chunk.map((attribute) => ({
          readingId: reading.id,
          diskId: reading.diskId,
          takenAt: reading.takenAt,
          attrId: attribute.attrId,
          name: attribute.name,
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
        })),
      )
      .run();
  }
  return reading;
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

  const ataSsdAttributes = ataSsdAttributesFrom(parsed, {
    ...row,
    vendor: effectiveVendor(row),
  });
  const pending = new Map(
    evaluateReading(parsed).attributes.map((attribute) => [
      attribute.attrId,
      attribute.transformedValue,
    ]),
  );
  const evaluated = evaluateNamedAttributes(
    parsed,
    ssdPolicyContext(
      ataSsdAttributes,
      parsed.deviceStatistics,
      risenDefects(row.id, ataSsdAttributes, receivedAt, pending),
    ),
  );
  const temp = presentTemperature(parsed.temperature);
  const smartPassed = parsed.smartStatus?.passed ?? null;
  const exitStatus = parsed.smartctl.exitStatus.raw;

  const isLatest =
    row.latestReadingAt === null || receivedAt >= row.latestReadingAt;
  const previous = isLatest ? latestReading(row.id) : null;
  const superseded = isLatest
    ? supersedeIfRisen(row.id, evaluated, receivedAt)
    : new Set<string>();
  const active = activeAcceptances(row.id);
  const deviceStatus = effectiveDeviceStatus(
    healthStatus(smartPassed, exitStatus),
    evaluated,
    active,
  );

  const reading = insertSmartReading(
    {
      diskId: row.id,
      hostId,
      takenAt: receivedAt,
      devicePath: parsed.device.name || meta.device || "",
      deviceType: meta.type ?? (parsed.device.type || null),
      smartPassed,
      exitStatus,
      temp,
      powerOnHours: parsed.powerOnHours ?? null,
      powerCycles: parsed.powerCycles ?? null,
      deviceStatus,
    },
    evaluated,
  );

  insertTemperatures(row.id, [
    ...(temp === null ? [] : [{ at: receivedAt, celsius: temp }]),
    ...sctTemperaturePoints(parsed.sctTemperatureHistory, receivedAt),
  ]);
  upsertSelfTests(row.id, parsed.selfTests, receivedAt);

  if (isLatest) {
    if (previous) {
      recordAttributeStatusChanges(
        row.id,
        attributesOfReading(previous.id),
        evaluated,
        receivedAt,
        superseded,
      );
    }
    recordStatusChange(row, deviceStatus, evaluated, active, receivedAt, {
      cause: "reading",
      superseded,
    });
    db.update(disk)
      .set({
        latestRaw: body,
        latestStatus: deviceStatus,
        latestTemp: temp,
        latestPowerOnHours: reading.powerOnHours,
        latestPowerCycles: reading.powerCycles,
        latestReadingAt: receivedAt,
        ataSsdAttributes,
        ...(parsed.farm ? { latestFarm: parsed.farm } : {}),
        ...(parsed.deviceStatistics
          ? { latestDeviceStatistics: parsed.deviceStatistics }
          : {}),
      })
      .where(eq(disk.id, row.id))
      .run();
  }

  return reading;
}

export function recomputeLatestStatus(
  diskId: number,
  now: Date,
  cause: StatusChangeCause,
) {
  const reading = latestReading(diskId);
  const row = db
    .select({
      id: disk.id,
      latestStatus: disk.latestStatus,
      latestReadingAt: disk.latestReadingAt,
    })
    .from(disk)
    .where(eq(disk.id, diskId))
    .get();
  if (!reading || !row) return;
  const attributes = attributesOfReading(reading.id);
  const active = activeAcceptances(diskId);
  const deviceStatus = effectiveDeviceStatus(
    healthStatus(reading.smartPassed, reading.exitStatus),
    attributes,
    active,
  );
  recordStatusChange(row, deviceStatus, attributes, active, now, { cause });
  db.update(smartReading)
    .set({ deviceStatus })
    .where(eq(smartReading.id, reading.id))
    .run();
  db.update(disk)
    .set({ latestStatus: deviceStatus })
    .where(eq(disk.id, diskId))
    .run();
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

function newestImportedReading(diskId: number, since: Date): Date | null {
  return (
    db
      .select({ takenAt: smartReading.takenAt })
      .from(smartReading)
      .where(
        and(
          eq(smartReading.diskId, diskId),
          ne(smartReading.source, "collector"),
          gte(smartReading.takenAt, since),
        ),
      )
      .orderBy(desc(smartReading.takenAt))
      .limit(1)
      .get()?.takenAt ?? null
  );
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
      source: smartReading.source,
    })
    .from(smartAttribute)
    .innerJoin(smartReading, eq(smartReading.id, smartAttribute.readingId))
    .where(
      and(
        eq(smartAttribute.diskId, diskId),
        gte(smartAttribute.takenAt, since),
      ),
    )
    .orderBy(asc(smartAttribute.takenAt), asc(smartAttribute.id))
    .all();

  const series = new Map<string, AttributePoint[]>();
  for (const { attrId, at, value, source } of attributeRows) {
    const points = series.get(attrId) ?? [];
    points.push(source === "collector" ? { at, value } : { at, value, source });
    series.set(attrId, points);
  }

  return {
    temperature: downsample(temperature),
    attributes: Object.fromEntries(
      [...series].map(([attrId, points]) => [attrId, downsample(points)]),
    ),
    importedUntil: newestImportedReading(diskId, since),
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

export function attributeTrend(
  diskId: number,
  attribute: Pick<SmartAttributeRow, "attrId" | "transformedValue" | "takenAt">,
): AttributeTrend {
  const metadata = metadataFor(diskProtocol(diskId), attribute.attrId);
  return trendDirection(
    metadata?.ideal ?? "",
    attribute.transformedValue,
    referenceValues(diskId, attribute.attrId, attribute.takenAt),
  );
}

export interface AttributeRise {
  risen: boolean;
  rise: number;
  readings: number;
}

export const NO_RISE: AttributeRise = { risen: false, rise: 0, readings: 0 };

export function riseOf(values: readonly number[]): AttributeRise {
  if (values.length < 2) return NO_RISE;
  let baseline = values[0] as number;
  let readings = 0;
  for (let index = 1; index < values.length; index++) {
    const value = values[index] as number;
    const preceding = values[index - 1] as number;
    if (value > preceding) readings++;
    if (value < preceding) baseline = value;
  }
  const rise = (values.at(-1) as number) - baseline;
  return { risen: rise > 0, rise, readings };
}

export function attributeSeries(
  diskId: number,
  attrId: string,
  at: Date,
  windowDays = 7,
): number[] {
  const windowStart = new Date(at.getTime() - windowDays * DAY_MS);
  const ofAttribute = and(
    eq(smartAttribute.diskId, diskId),
    eq(smartAttribute.attrId, attrId),
  );
  const before = db
    .select({ value: smartAttribute.transformedValue })
    .from(smartAttribute)
    .where(and(ofAttribute, lte(smartAttribute.takenAt, windowStart)))
    .orderBy(desc(smartAttribute.takenAt), desc(smartAttribute.id))
    .limit(1)
    .get();
  const within = db
    .select({ value: smartAttribute.transformedValue })
    .from(smartAttribute)
    .where(
      and(
        ofAttribute,
        gt(smartAttribute.takenAt, windowStart),
        lte(smartAttribute.takenAt, at),
      ),
    )
    .orderBy(asc(smartAttribute.takenAt), asc(smartAttribute.id))
    .all();
  return [
    ...(before ? [before.value] : []),
    ...within.map(({ value }) => value),
  ];
}

export function attributeRise(
  diskId: number,
  attrId: string,
  at: Date,
  windowDays = 7,
): AttributeRise {
  return riseOf(attributeSeries(diskId, attrId, at, windowDays));
}

function isAttributeStatus(value: unknown): value is AttributeStatus {
  return ATTRIBUTE_STATUSES.includes(value as AttributeStatus);
}

function statusChangesByAttribute(
  diskId: number,
): Map<string, AttributeStatusChange[]> {
  const entries = db
    .select({ at: diaryEntry.at, data: diaryEntry.data })
    .from(diaryEntry)
    .where(
      and(
        eq(diaryEntry.subjectType, "disk"),
        eq(diaryEntry.subjectId, diskId),
        eq(diaryEntry.eventType, "attribute-status-changed"),
      ),
    )
    .orderBy(desc(diaryEntry.at), desc(diaryEntry.id))
    .all();
  const changes = new Map<string, AttributeStatusChange[]>();
  for (const { at, data } of entries) {
    const { attrId, from, to, value } = data;
    if (typeof attrId !== "string" || typeof value !== "number") continue;
    if (!isAttributeStatus(from) || !isAttributeStatus(to)) continue;
    const forAttribute = changes.get(attrId) ?? [];
    forAttribute.push({ at, from, to, value });
    changes.set(attrId, forAttribute);
  }
  return changes;
}

function valueSince(
  diskId: number,
  attrId: string,
  transformedValue: number,
  takenAt: Date,
): Date {
  const ofAttribute = and(
    eq(smartAttribute.diskId, diskId),
    eq(smartAttribute.attrId, attrId),
  );
  const lastDifferent = db
    .select({ takenAt: smartAttribute.takenAt })
    .from(smartAttribute)
    .where(
      and(
        ofAttribute,
        lte(smartAttribute.takenAt, takenAt),
        ne(smartAttribute.transformedValue, transformedValue),
      ),
    )
    .orderBy(desc(smartAttribute.takenAt), desc(smartAttribute.id))
    .limit(1)
    .get();
  const runStart = db
    .select({ takenAt: smartAttribute.takenAt })
    .from(smartAttribute)
    .where(
      lastDifferent
        ? and(ofAttribute, gt(smartAttribute.takenAt, lastDifferent.takenAt))
        : ofAttribute,
    )
    .orderBy(asc(smartAttribute.takenAt), asc(smartAttribute.id))
    .limit(1)
    .get();
  return runStart?.takenAt ?? takenAt;
}

function firstNonZeroAt(diskId: number, attrId: string): Date | null {
  return (
    db
      .select({ takenAt: smartAttribute.takenAt })
      .from(smartAttribute)
      .where(
        and(
          eq(smartAttribute.diskId, diskId),
          eq(smartAttribute.attrId, attrId),
          gt(smartAttribute.transformedValue, 0),
        ),
      )
      .orderBy(asc(smartAttribute.takenAt), asc(smartAttribute.id))
      .limit(1)
      .get()?.takenAt ?? null
  );
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

export function diskProtocol(diskId: number): SmartProtocol | undefined {
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
  const active = activeAcceptances(diskId);
  const changes = statusChangesByAttribute(diskId);
  return attributesOfReading(reading.id).map(
    ({ id: _id, readingId: _readingId, diskId: _diskId, ...attribute }) => {
      const metadata = summariseMetadata(protocol, attribute.attrId);
      const acceptance = active.get(attribute.attrId);
      const attributeChanges = changes.get(attribute.attrId) ?? [];
      return {
        ...attribute,
        trend: trendDirection(
          metadata?.ideal ?? "",
          attribute.transformedValue,
          referenceValues(diskId, attribute.attrId, attribute.takenAt),
        ),
        metadata,
        displayStatus: overlayStatus(
          attribute.status,
          attribute.transformedValue,
          acceptance,
        ),
        acceptance: acceptance
          ? {
              id: acceptance.id,
              kind: acceptance.kind,
              acceptedValue: acceptance.acceptedValue,
              acceptedAt: acceptance.acceptedAt,
              note: acceptance.note,
            }
          : null,
        statusChanges: attributeChanges.slice(0, MAX_STATUS_CHANGES),
        statusSince:
          attributeChanges.find((change) => change.to === attribute.status)
            ?.at ?? null,
        valueSince: valueSince(
          diskId,
          attribute.attrId,
          attribute.transformedValue,
          attribute.takenAt,
        ),
        firstNonZeroAt: firstNonZeroAt(diskId, attribute.attrId),
      };
    },
  );
}

function listSelfTests(diskId: number): SelfTestRow[] {
  return db
    .select()
    .from(selfTest)
    .where(eq(selfTest.diskId, diskId))
    .orderBy(desc(selfTest.lifetimeHours), desc(selfTest.id))
    .all();
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
    selfTests: listSelfTests(diskId),
    acceptances: listAcceptances(diskId),
  };
}
