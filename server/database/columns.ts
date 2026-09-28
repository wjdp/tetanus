import { integer, text } from "drizzle-orm/sqlite-core";

export const autoIncrementId = () =>
  integer().primaryKey({ autoIncrement: true });
export const datetime = () => integer({ mode: "timestamp_ms" });
export const boolean = () => integer({ mode: "boolean" });
export const json = () => text({ mode: "json" });
