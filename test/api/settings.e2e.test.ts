import { $fetch, fetch, setup } from "@nuxt/test-utils/e2e";
import { afterAll, describe, expect, it } from "vitest";
import { createDb } from "~~/server/database/client";
import { runMigrations } from "~~/server/database/migrate";
import { createTestDatabaseFile, startNuxtServer } from "./devServer";

const databaseFile = createTestDatabaseFile();
const { sqlite, db } = createDb(databaseFile);
runMigrations(sqlite, db);
sqlite.close();

const server = await startNuxtServer(databaseFile);
afterAll(() => server.stop());

await setup({ host: server.host });

describe("GET /health", () => {
  it("reports the database as healthy", async () => {
    expect(await $fetch("/health")).toEqual({
      ok: true,
      checks: { database: true },
    });
  });
});

describe("/api/settings", () => {
  it("returns a generated enrol token and default config", async () => {
    const settings = await $fetch("/api/settings");
    expect(settings.enrolToken).toMatch(/^[0-9a-f]{64}$/);
    expect(settings.config.missingAfterDays).toBe(7);
  });

  it("patches config", async () => {
    const settings = await $fetch("/api/settings", {
      method: "PATCH",
      body: { config: { missingAfterDays: 14 } },
    });
    expect(settings.config.missingAfterDays).toBe(14);
    expect((await $fetch("/api/settings")).config.missingAfterDays).toBe(14);
  });

  it("400s for an invalid patch", async () => {
    const response = await fetch("/api/settings", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ config: { missingAfterDays: -1 } }),
    });
    expect(response.status).toBe(400);
  });
});
