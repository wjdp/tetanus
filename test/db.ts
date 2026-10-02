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
