import { sql } from "drizzle-orm";
import { check, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { autoIncrementId, json } from "./columns";

export const setting = sqliteTable(
  "Setting",
  {
    id: autoIncrementId(),
    enrolToken: text().notNull(),
    config: json().$type<Record<string, unknown>>().notNull().default({}),
  },
  (table) => [check("Setting_single_row", sql`${table.id} = 1`)],
);
