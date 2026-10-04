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

describe("/api/database", () => {
  it("reports the size and optimises", async () => {
    const size = await $fetch("/api/database");
    expect(size.bytes).toBeGreaterThan(0);

    const { before, after } = await $fetch("/api/database/optimise", {
      method: "POST",
    });
    expect(before.bytes).toBeGreaterThan(0);
    expect(after.reclaimableBytes).toBe(0);
  });
});

describe("/api/settings", () => {
  it("returns a generated enrol token and default config", async () => {
    const settings = await $fetch("/api/settings");
    expect(settings.enrolToken).toMatch(/^[0-9a-f]{64}$/);
    expect(settings.config.missingAfterDays).toBe(7);
    expect(settings.config.currency).toBe("GBP");
  });

  it("patches the currency and 400s for an unknown one", async () => {
    const settings = await $fetch("/api/settings", {
      method: "PATCH",
      body: { config: { currency: "usd" } },
    });
    expect(settings.config.currency).toBe("USD");

    const response = await fetch("/api/settings", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ config: { currency: "XYZ" } }),
    });
    expect(response.status).toBe(400);
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

  it("stores notification secrets and returns them", async () => {
    const notifications = {
      pushover: { token: "app-token", user: "user-key" },
      webhook: { url: "https://hooks.example/t", secret: "s3cret" },
    };
    const saved = await $fetch("/api/settings", {
      method: "PATCH",
      body: { config: { notifications } },
    });
    expect(saved.config.notifications).toEqual(notifications);
    expect((await $fetch("/api/settings")).config.notifications).toEqual(
      notifications,
    );
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
