import {
  type DrizzleSqliteDODatabase,
  drizzle,
} from "drizzle-orm/durable-sqlite";
import * as schema from "../../server/database/schema";
import { boundStorage } from "./bridge";

export type Db = DrizzleSqliteDODatabase<typeof schema>;

const instances = new WeakMap<DurableObjectStorage, Db>();

function boundDb(): Db {
  const storage = boundStorage();
  let instance = instances.get(storage);
  if (!instance) {
    instance = drizzle(storage, { schema });
    instances.set(storage, instance);
  }
  return instance;
}

export const db = new Proxy({} as Db, {
  get: (_, property) => Reflect.get(boundDb(), property),
});

export const sqlite = {
  prepare: (query: string) => ({
    get: () => boundStorage().sql.exec(query).toArray()[0],
  }),
};

export function databasePath() {
  return "Durable Object SQLite";
}
