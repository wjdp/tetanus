import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { TestProject } from "vitest/node";

/**
 * Seeds the demo fleet once per run into a file database; each seeded test file
 * copies it into its own `:memory:` database with `loadSeededDatabase`.
 */
export default async function setup(project: TestProject) {
  const directory = mkdtempSync(join(tmpdir(), "tetanus-seed-"));
  const path = join(directory, "seed.db");
  const databaseUrl = process.env.DATABASE_URL;
  process.env.DATABASE_URL = path;
  try {
    await import("./setup");
    const { seed } = await import("~~/server/demo/seed");
    const { SEEDED_AT } = await import("./seeded");
    const { sqlite } = await import("~~/server/database/client");
    await seed(SEEDED_AT, { replay: "short" });
    sqlite.close();
  } finally {
    process.env.DATABASE_URL = databaseUrl;
  }
  project.provide("seededDatabasePath", path);
  return () => rmSync(directory, { recursive: true, force: true });
}
