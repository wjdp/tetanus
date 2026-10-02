import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "./schema";

const CACHED_STATEMENTS = 500;

export function databasePath(url = process.env.DATABASE_URL): string {
  if (!url) return "./dev.db";
  return url.startsWith("file:") ? url.slice("file:".length) : url;
}

// Drizzle prepares a fresh statement for every query. Each holds native memory
// that V8 cannot see, so it is only freed when a GC happens to run; a burst of
// queries (seeding, backfills) balloons the process by gigabytes. Reusing
// statements by SQL keeps that bounded.
function withStatementCache(sqlite: Database.Database): Database.Database {
  const statements = new Map<string, Database.Statement>();
  const prepare = (source: string) => {
    let statement = statements.get(source);
    if (statement) {
      statements.delete(source);
    } else {
      statement = sqlite.prepare(source);
      if (statements.size >= CACHED_STATEMENTS) {
        statements.delete(statements.keys().next().value as string);
      }
    }
    statements.set(source, statement);
    // Drizzle switches statements into raw mode; reset it for the next caller.
    return statement.reader ? statement.raw(false) : statement;
  };
  return Object.assign(Object.create(sqlite), { prepare });
}

export function createDb(path = databasePath()) {
  const sqlite = new Database(path);
  sqlite.pragma("foreign_keys = ON");
  return {
    sqlite,
    db: drizzle({ client: withStatementCache(sqlite), schema }),
  };
}

export type Db = ReturnType<typeof createDb>["db"];

const connection = createDb();

export const sqlite = connection.sqlite;
export const db = connection.db;
