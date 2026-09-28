import { sql } from "drizzle-orm";
import { check, sqliteTable, text } from "drizzle-orm/sqlite-core";
import type { SettingsConfig } from "../../shared/schemas/settings";
import { autoIncrementId, json } from "./columns";

export const setting = sqliteTable(
  "Setting",
  {
    id: autoIncrementId(),
    enrolToken: text().notNull(),
    config: json().$type<Partial<SettingsConfig>>().notNull().default({}),
  },
  (table) => [check("Setting_single_row", sql`${table.id} = 1`)],
);
