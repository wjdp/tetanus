import { inject } from "vitest";
import { sqlite } from "~~/server/database/client";
import { DEMO_EPOCH, HOUR_MS } from "~~/server/demo/timeline";

declare module "vitest" {
  export interface ProvidedContext {
    seededDatabasePath: string;
  }
}

export const SEEDED_AT = new Date(DEMO_EPOCH.getTime() + 2 * HOUR_MS);

/** Replaces this file's database with the demo fleet seeded at `SEEDED_AT` by `seed.globalSetup.ts`. */
export function loadSeededDatabase() {
  sqlite
    .prepare("ATTACH DATABASE ? AS seeded")
    .run(inject("seededDatabasePath"));
  const tables = sqlite
    .prepare(
      "SELECT name FROM seeded.sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '__drizzle%'",
    )
    .pluck()
    .all() as string[];
  sqlite.pragma("foreign_keys = OFF");
  sqlite.transaction(() => {
    for (const table of [...tables, "sqlite_sequence"]) {
      sqlite.exec(`DELETE FROM main."${table}"`);
      sqlite.exec(
        `INSERT INTO main."${table}" SELECT * FROM seeded."${table}"`,
      );
    }
  })();
  sqlite.pragma("foreign_keys = ON");
  sqlite.exec("DETACH DATABASE seeded");
}
