import { $fetch, fetch, setup } from "@nuxt/test-utils/e2e";
import { afterAll, describe, expect, it } from "vitest";
import { createDb } from "~~/server/database/client";
import { runMigrations } from "~~/server/database/migrate";
import { createTestDatabaseFile, startNuxtServer } from "./devServer";

const databaseFile = createTestDatabaseFile();
const { sqlite, db } = createDb(databaseFile);
runMigrations(sqlite, db);
sqlite.close();

const server = await startNuxtServer(databaseFile, {
  NUXT_PUBLIC_DEMO: "true",
});
afterAll(() => server.stop());

await setup({ host: server.host });

const json = (method: string, body: unknown) => ({
  method,
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

describe("demo mode", () => {
  it("rejects ingest before the token check", async () => {
    const response = await fetch("/api/ingest/versions", {
      method: "POST",
      headers: { authorization: "Bearer wrong" },
      body: "{}",
    });
    expect(response.status).toBe(403);
    expect((await response.json()).statusMessage).toBe(
      "Ingest is disabled in the demo",
    );
  });

  it("rejects the Scrutiny import and task creation", async () => {
    const scrutiny = await fetch(
      "/api/import/scrutiny",
      json("POST", { url: "http://localhost:8080", hostId: 1, dryRun: true }),
    );
    const task = await fetch(
      "/api/tasks",
      json("POST", { taskName: "alerts:tick", payload: {} }),
    );
    expect(scrutiny.status).toBe(403);
    expect(task.status).toBe(403);
  });

  it("masks the enrol token and notification channels", async () => {
    const settings = await $fetch<{
      enrolToken: string;
      config: { notifications: unknown };
    }>("/api/settings");
    expect(settings.enrolToken).toBe("demo");
    expect(settings.config.notifications).toEqual({
      pushover: null,
      webhook: null,
    });
  });

  it("rejects notification changes but accepts other settings", async () => {
    const rejected = await fetch(
      "/api/settings",
      json("PATCH", {
        config: { notifications: { webhook: { url: "https://example.com" } } },
      }),
    );
    expect(rejected.status).toBe(400);
    expect((await rejected.json()).statusMessage).toBe(
      "Notification channels are disabled in the demo",
    );

    const accepted = await fetch(
      "/api/settings",
      json("PATCH", { config: { missingAfterDays: 9 } }),
    );
    expect(accepted.status).toBe(200);
    expect((await accepted.json()).enrolToken).toBe("demo");
  });

  it("refuses test notifications", async () => {
    expect(
      await $fetch("/api/alerts/test", {
        method: "POST",
        body: { channel: "webhook" },
      }),
    ).toEqual({ ok: false, error: "Disabled in the demo" });
  });

  it("hides the collector scripts", async () => {
    expect((await fetch("/host/install.sh")).status).toBe(404);
  });
});
