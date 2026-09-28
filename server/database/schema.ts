import { sql } from "drizzle-orm";
import {
  type AnySQLiteColumn,
  check,
  index,
  integer,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import type { DiaryEntryKind, DiarySubjectType } from "../../shared/diary";
import type {
  DiskKeyKind,
  DiskProtocol,
  DiskState,
  StateOverride,
} from "../../shared/disk";
import type { Inventory } from "../../shared/inventory-fields";
import type { SettingsConfig } from "../../shared/schemas/settings";
import type { AttributeStatus, DeviceStatus } from "../../shared/smart/status";
import type { ZpoolStatusScan } from "../ingest/zpool-status";
import { autoIncrementId, boolean, datetime, json } from "./columns";

export const setting = sqliteTable(
  "Setting",
  {
    id: autoIncrementId(),
    enrolToken: text().notNull(),
    config: json().$type<Partial<SettingsConfig>>().notNull().default({}),
  },
  (table) => [check("Setting_single_row", sql`${table.id} = 1`)],
);

export const host = sqliteTable("Host", {
  id: autoIncrementId(),
  name: text().notNull().unique(),
  displayName: text(),
  toolVersions: json().$type<Record<string, string>>().notNull().default({}),
  healthchecksUrl: text(),
  notes: text().notNull().default(""),
  firstSeenAt: datetime().notNull(),
  lastSeenAt: datetime().notNull(),
});

export const collectorRun = sqliteTable(
  "CollectorRun",
  {
    id: autoIncrementId(),
    hostId: integer()
      .notNull()
      .references(() => host.id, { onDelete: "cascade" }),
    source: text().notNull(),
    device: text(),
    deviceType: text(),
    exitStatus: integer(),
    receivedAt: datetime().notNull(),
    ok: boolean().notNull(),
    error: text(),
    bytes: integer().notNull(),
    producer: text(),
  },
  (table) => [
    index("CollectorRun_hostId_source_receivedAt_idx").on(
      table.hostId,
      table.source,
      table.receivedAt,
    ),
  ],
);

export const NO_DEVICE = "";

export const payload = sqliteTable(
  "Payload",
  {
    id: autoIncrementId(),
    hostId: integer()
      .notNull()
      .references(() => host.id, { onDelete: "cascade" }),
    source: text().notNull(),
    device: text().notNull().default(NO_DEVICE),
    receivedAt: datetime().notNull(),
    body: text().notNull(),
  },
  (table) => [
    uniqueIndex("Payload_hostId_source_device_key").on(
      table.hostId,
      table.source,
      table.device,
    ),
  ],
);

export const disk = sqliteTable("Disk", {
  id: autoIncrementId(),
  alias: text().unique(),
  scrutinyUuid: text(),
  model: text(),
  modelFamily: text(),
  serial: text(),
  firmware: text(),
  capacityBytes: integer(),
  rotationRate: integer(),
  protocol: text().$type<DiskProtocol>(),
  transport: text(),
  formFactor: text(),
  firstSeenAt: datetime(),
  lastSeenAt: datetime(),
  lastSeenHostId: integer().references(() => host.id, {
    onDelete: "set null",
  }),
  lastDevicePath: text(),
  lastDeviceType: text(),
  stateOverride: text().$type<StateOverride>(),
  lastState: text().$type<DiskState | StateOverride>(),
  notes: text().notNull().default(""),
  inventory: json().$type<Partial<Inventory>>().notNull().default({}),
  latestRaw: text(),
  latestStatus: text().$type<DeviceStatus>().notNull().default("unknown"),
  latestTemp: integer(),
  latestPowerOnHours: integer(),
  latestPowerCycles: integer(),
  latestReadingAt: datetime(),
});

export const diskKey = sqliteTable(
  "DiskKey",
  {
    id: autoIncrementId(),
    diskId: integer()
      .notNull()
      .references(() => disk.id, { onDelete: "cascade" }),
    kind: text().$type<DiskKeyKind>().notNull(),
    value: text().notNull(),
  },
  (table) => [
    uniqueIndex("DiskKey_kind_value_key").on(table.kind, table.value),
    index("DiskKey_diskId_idx").on(table.diskId),
  ],
);

export const smartReading = sqliteTable(
  "SmartReading",
  {
    id: autoIncrementId(),
    diskId: integer()
      .notNull()
      .references(() => disk.id, { onDelete: "cascade" }),
    hostId: integer()
      .notNull()
      .references(() => host.id, { onDelete: "cascade" }),
    takenAt: datetime().notNull(),
    devicePath: text().notNull(),
    deviceType: text(),
    smartPassed: boolean(),
    exitStatus: integer(),
    temp: integer(),
    powerOnHours: integer(),
    powerCycles: integer(),
    deviceStatus: text().$type<DeviceStatus>().notNull(),
  },
  (table) => [
    index("SmartReading_diskId_takenAt_idx").on(table.diskId, table.takenAt),
  ],
);

export const smartAttribute = sqliteTable(
  "SmartAttribute",
  {
    id: autoIncrementId(),
    readingId: integer()
      .notNull()
      .references(() => smartReading.id, { onDelete: "cascade" }),
    diskId: integer()
      .notNull()
      .references(() => disk.id, { onDelete: "cascade" }),
    takenAt: datetime().notNull(),
    attrId: text().notNull(),
    name: text().notNull(),
    value: integer(),
    worst: integer(),
    thresh: integer(),
    rawValue: integer(),
    rawString: text(),
    whenFailed: text(),
    transformedValue: integer().notNull(),
    status: text().$type<AttributeStatus>().notNull(),
    failureRate: real(),
    reason: text(),
  },
  (table) => [
    index("SmartAttribute_diskId_attrId_takenAt_idx").on(
      table.diskId,
      table.attrId,
      table.takenAt,
    ),
    index("SmartAttribute_readingId_idx").on(table.readingId),
  ],
);

export const temperatureReading = sqliteTable(
  "TemperatureReading",
  {
    id: autoIncrementId(),
    diskId: integer()
      .notNull()
      .references(() => disk.id, { onDelete: "cascade" }),
    at: datetime().notNull(),
    celsius: integer().notNull(),
  },
  (table) => [
    uniqueIndex("TemperatureReading_diskId_at_key").on(table.diskId, table.at),
  ],
);

export const selfTest = sqliteTable(
  "SelfTest",
  {
    id: autoIncrementId(),
    diskId: integer()
      .notNull()
      .references(() => disk.id, { onDelete: "cascade" }),
    type: text().notNull(),
    status: text().notNull(),
    passed: boolean().notNull(),
    lifetimeHours: integer().notNull(),
    lba: integer(),
    seenAt: datetime().notNull(),
  },
  (table) => [
    uniqueIndex("SelfTest_diskId_type_lifetimeHours_key").on(
      table.diskId,
      table.type,
      table.lifetimeHours,
    ),
  ],
);

export const pool = sqliteTable(
  "Pool",
  {
    id: autoIncrementId(),
    hostId: integer()
      .notNull()
      .references(() => host.id, { onDelete: "cascade" }),
    guid: text().notNull().unique(),
    name: text().notNull(),
    state: text().notNull(),
    status: text(),
    action: text(),
    health: text(),
    errors: integer(),
    sizeBytes: integer(),
    allocBytes: integer(),
    freeBytes: integer(),
    frag: integer(),
    cap: integer(),
    dedup: real(),
    scan: json().$type<ZpoolStatusScan>(),
    firstSeenAt: datetime().notNull(),
    lastSeenAt: datetime().notNull(),
  },
  (table) => [index("Pool_hostId_idx").on(table.hostId)],
);

export const vdev = sqliteTable(
  "Vdev",
  {
    id: autoIncrementId(),
    poolId: integer()
      .notNull()
      .references(() => pool.id, { onDelete: "cascade" }),
    guid: text().notNull().unique(),
    parentId: integer().references((): AnySQLiteColumn => vdev.id, {
      onDelete: "set null",
    }),
    name: text().notNull(),
    type: text().notNull(),
    state: text().notNull(),
    readErrors: integer().notNull().default(0),
    writeErrors: integer().notNull().default(0),
    checksumErrors: integer().notNull().default(0),
    slowIos: integer(),
    path: text(),
    devid: text(),
    physPath: text(),
    diskId: integer().references(() => disk.id, { onDelete: "set null" }),
    allocBytes: integer(),
    sizeBytes: integer(),
    frag: integer(),
    present: boolean().notNull().default(true),
    lastSeenAt: datetime().notNull(),
  },
  (table) => [
    index("Vdev_poolId_idx").on(table.poolId),
    index("Vdev_diskId_idx").on(table.diskId),
  ],
);

export const poolReading = sqliteTable(
  "PoolReading",
  {
    id: autoIncrementId(),
    poolId: integer()
      .notNull()
      .references(() => pool.id, { onDelete: "cascade" }),
    at: datetime().notNull(),
    allocBytes: integer(),
    freeBytes: integer(),
    frag: integer(),
    cap: integer(),
    state: text().notNull(),
  },
  (table) => [index("PoolReading_poolId_at_idx").on(table.poolId, table.at)],
);

export const vdevReading = sqliteTable(
  "VdevReading",
  {
    id: autoIncrementId(),
    vdevId: integer()
      .notNull()
      .references(() => vdev.id, { onDelete: "cascade" }),
    at: datetime().notNull(),
    readErrors: integer().notNull(),
    writeErrors: integer().notNull(),
    checksumErrors: integer().notNull(),
    slowIos: integer(),
    state: text().notNull(),
  },
  (table) => [index("VdevReading_vdevId_at_idx").on(table.vdevId, table.at)],
);

export const zfsEvent = sqliteTable(
  "ZfsEvent",
  {
    id: autoIncrementId(),
    hostId: integer()
      .notNull()
      .references(() => host.id, { onDelete: "cascade" }),
    eid: integer(),
    at: datetime().notNull(),
    class: text().notNull(),
    poolGuid: text(),
    vdevGuid: text(),
    payload: json().$type<Record<string, unknown>>().notNull(),
  },
  (table) => [
    uniqueIndex("ZfsEvent_hostId_eid_key").on(table.hostId, table.eid),
    index("ZfsEvent_hostId_at_idx").on(table.hostId, table.at),
  ],
);

export const poolHistory = sqliteTable(
  "PoolHistory",
  {
    id: autoIncrementId(),
    hostId: integer()
      .notNull()
      .references(() => host.id, { onDelete: "cascade" }),
    poolId: integer().references(() => pool.id, { onDelete: "set null" }),
    at: datetime().notNull(),
    internal: boolean().notNull(),
    text: text().notNull(),
  },
  (table) => [
    uniqueIndex("PoolHistory_hostId_at_text_key").on(
      table.hostId,
      table.at,
      table.text,
    ),
    index("PoolHistory_poolId_at_idx").on(table.poolId, table.at),
  ],
);

export const diaryEntry = sqliteTable(
  "DiaryEntry",
  {
    id: autoIncrementId(),
    subjectType: text().$type<DiarySubjectType>().notNull(),
    subjectId: integer(),
    at: datetime().notNull(),
    kind: text().$type<DiaryEntryKind>().notNull(),
    eventType: text(),
    title: text().notNull(),
    body: text().notNull().default(""),
    data: json().$type<Record<string, unknown>>().notNull().default({}),
  },
  (table) => [
    index("DiaryEntry_subjectType_subjectId_at_idx").on(
      table.subjectType,
      table.subjectId,
      table.at,
    ),
    index("DiaryEntry_at_idx").on(table.at),
  ],
);
