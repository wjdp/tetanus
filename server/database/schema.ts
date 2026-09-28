import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import type { SettingsConfig } from "../../shared/schemas/settings";
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
