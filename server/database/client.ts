import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "./schema";

export function databasePath(url = process.env.DATABASE_URL): string {
  if (!url) return "./dev.db";
  return url.startsWith("file:") ? url.slice("file:".length) : url;
}

export function createDb(path = databasePath()) {
  const sqlite = new Database(path);
  sqlite.pragma("foreign_keys = ON");
  return { sqlite, db: drizzle(sqlite, { schema }) };
}

export type Db = ReturnType<typeof createDb>["db"];

const connection = createDb();

export const sqlite = connection.sqlite;
export const db = connection.db;
