import { createHash } from "node:crypto";
import { serialize } from "node:v8";
import { getTableConfig } from "drizzle-orm/sqlite-core";
import { db, sqlite } from "~~/server/database/client";
import {
  collectorRun,
  diaryEntry,
  disk,
  diskKey,
  fault,
  faultAcceptance,
  host,
  notification,
  payload,
  pool,
  poolHistory,
  poolReading,
  replication,
  replicationSync,
  selfTest,
  setting,
  smartAttribute,
  smartReading,
  temperatureReading,
  vdev,
  vdevReading,
  zfsEvent,
} from "~~/server/database/schema";
import { schemaTables } from "~~/server/services/simulator/capture";

const TABLES_CHILDREN_FIRST = [
  replicationSync,
  replication,
  smartAttribute,
  smartReading,
  temperatureReading,
  selfTest,
  vdevReading,
  vdev,
  poolReading,
  poolHistory,
  pool,
  zfsEvent,
  fault,
  faultAcceptance,
  diskKey,
  disk,
  notification,
  diaryEntry,
  collectorRun,
  payload,
  host,
  setting,
];

export function flushDb() {
  for (const table of TABLES_CHILDREN_FIRST) db.delete(table).run();
}

/**
 * A digest of every row of every schema table, rowid included, for comparing
 * whole-database states. Only the digest is kept, so a mismatch names the table
 * without holding or deep-comparing the rows twice.
 */
export function dumpDatabase() {
  return schemaTables()
    .map((table) => getTableConfig(table).name)
    .sort()
    .map((name) => {
      const rows = sqlite
        .prepare(`SELECT rowid, * FROM "${name}" ORDER BY rowid`)
        .raw()
        .all();
      const hash = createHash("sha1").update(serialize(rows)).digest("hex");
      return { name, rows: rows.length, hash };
    });
}
