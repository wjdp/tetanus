import { sql } from "drizzle-orm";
import { getTableConfig } from "drizzle-orm/sqlite-core";
import { db } from "~~/server/database/client";
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

/** Every row of every schema table, rowid included, for comparing whole-database states. */
export function dumpDatabase() {
  return schemaTables()
    .map((table) => getTableConfig(table).name)
    .sort()
    .map((name) => ({
      name,
      rows: db.all(
        sql.raw(`SELECT rowid AS __rowid, * FROM "${name}" ORDER BY rowid`),
      ),
    }));
}
