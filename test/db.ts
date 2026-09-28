import { db } from "~~/server/database/client";
import { setting } from "~~/server/database/schema";

const TABLES = [setting];

export function flushDb() {
  for (const table of TABLES) db.delete(table).run();
}
