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

interface HealthResponse {
  ok: boolean;
  checks: { database: boolean };
}

describe("GET /health", () => {
  it("reports the database as healthy", async () => {
    expect(await $fetch<HealthResponse>("/health")).toEqual({
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

  it("masks notification secrets and keeps them when the mask is sent back", async () => {
    const saved = await $fetch("/api/settings", {
      method: "PATCH",
      body: {
        config: {
          notifications: {
            pushover: { token: "app-token", user: "user-key" },
            webhook: { url: "https://hooks.example/t", secret: "s3cret" },
          },
        },
      },
    });
    const masked = {
      pushover: { token: "•••", user: "•••" },
      webhook: { url: "https://hooks.example/t", secret: "•••" },
    };
    expect(saved.config.notifications).toEqual(masked);

    const resaved = await $fetch("/api/settings", {
      method: "PATCH",
      body: { config: { notifications: masked } },
    });
    expect(resaved.config.notifications).toEqual(masked);
    const { sqlite: check } = createDb(databaseFile);
    const [config] = check
      .prepare(`SELECT config FROM Setting`)
      .raw()
      .get() as [string];
    check.close();
    expect(JSON.parse(config).notifications).toEqual({
      pushover: { token: "app-token", user: "user-key" },
      webhook: { url: "https://hooks.example/t", secret: "s3cret" },
    });
  });

  it("400s when the mask is sent with nothing stored", async () => {
    await $fetch("/api/settings", {
      method: "PATCH",
      body: { config: { notifications: { pushover: null } } },
    });
    const response = await fetch("/api/settings", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        config: { notifications: { pushover: { token: "•••", user: "•••" } } },
      }),
    });
    expect(response.status).toBe(400);
  });

  it("refuses to move the alert cursor", async () => {
    const response = await fetch("/api/settings", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ config: { alertCursor: 0 } }),
    });
    expect(response.status).toBe(400);
  });
});
