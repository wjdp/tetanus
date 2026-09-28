import { db } from "~~/server/database/client";
import {
  collectorRun,
  host,
  payload,
  setting,
} from "~~/server/database/schema";

const TABLES_CHILDREN_FIRST = [collectorRun, payload, host, setting];

export function flushDb() {
  for (const table of TABLES_CHILDREN_FIRST) db.delete(table).run();
}
