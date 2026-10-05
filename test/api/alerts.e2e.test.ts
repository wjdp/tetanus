import { createHmac } from "node:crypto";
import { createServer, type IncomingHttpHeaders } from "node:http";
import type { AddressInfo } from "node:net";
import { $fetch, fetch, setup } from "@nuxt/test-utils/e2e";
import { afterAll, describe, expect, it, vi } from "vitest";
import { createDb } from "~~/server/database/client";
import { runMigrations } from "~~/server/database/migrate";
import {
  diaryEntry,
  disk,
  host,
  notification,
} from "~~/server/database/schema";
import { createTestDatabaseFile, startNuxtServer } from "./devServer";

const databaseFile = createTestDatabaseFile();
const { sqlite, db } = createDb(databaseFile);
runMigrations(sqlite, db);

const received: { headers: IncomingHttpHeaders; body: string }[] = [];
const receiver = createServer((request, response) => {
  let body = "";
  request.on("data", (chunk) => {
    body += chunk;
  });
  request.on("end", () => {
    received.push({ headers: request.headers, body });
    response.writeHead(204).end();
  });
});
await new Promise<void>((resolve) => receiver.listen(0, "127.0.0.1", resolve));
const receiverUrl = `http://127.0.0.1:${(receiver.address() as AddressInfo).port}/hook`;

const server = await startNuxtServer(databaseFile);
afterAll(() => {
  server.stop();
  receiver.close();
  sqlite.close();
});

await setup({ host: server.host });

function postTest(body: unknown) {
  return fetch("/api/alerts/test", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("GET /api/alerts", () => {
  it("lists notifications newest first", async () => {
    const base = {
      channel: "pushover" as const,
      rule: "pool-degraded" as const,
      subject: "mars · tank",
      title: "Pool degraded",
      message: "mars · tank: DEGRADED (was ONLINE)",
    };
    db.insert(notification)
      .values([
        {
          ...base,
          at: new Date("2026-09-01T10:00:00Z"),
          dedupeKey: "older",
          ok: true,
        },
        {
          ...base,
          at: new Date("2026-09-02T10:00:00Z"),
          dedupeKey: "newer",
          ok: false,
          error: "HTTP 500",
        },
      ])
      .run();

    const all = await $fetch("/api/alerts");
    expect(all.map((row) => row.dedupeKey)).toEqual(["newer", "older"]);
    expect(all[0]).toMatchObject({
      ...base,
      at: "2026-09-02T10:00:00.000Z",
      ok: false,
      error: "HTTP 500",
      diaryEntryId: null,
    });

    const limited = await $fetch("/api/alerts", { query: { limit: 1 } });
    expect(limited.map((row) => row.dedupeKey)).toEqual(["newer"]);
  });

  it("400s for an invalid limit", async () => {
    expect((await fetch("/api/alerts?limit=0")).status).toBe(400);
  });
});

describe("POST /api/alerts/test", () => {
  it("reports a channel that is not configured", async () => {
    const response = await postTest({ channel: "pushover" });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: false,
      error: "pushover is not configured",
    });
  });

  it("400s for an unknown channel", async () => {
    expect((await postTest({ channel: "carrier-pigeon" })).status).toBe(400);
  });

  it("sends a signed test message to the webhook", async () => {
    await $fetch("/api/settings", {
      method: "PATCH",
      body: {
        config: {
          notifications: { webhook: { url: receiverUrl, secret: "s3cret" } },
        },
      },
    });

    const response = await postTest({ channel: "webhook" });

    expect(await response.json()).toEqual({ ok: true, error: null });
    const [delivery] = received;
    expect(JSON.parse(delivery.body)).toMatchObject({
      rule: "test",
      severity: "test",
      subject: "tetanus",
    });
    expect(delivery.headers["tetanus-signature"]).toBe(
      `sha256=${createHmac("sha256", "s3cret").update(delivery.body).digest("hex")}`,
    );
  });
});

describe("alerts:tick", () => {
  it("sends new diary alerts through the task queue", async () => {
    const now = new Date();
    const mars = db
      .insert(host)
      .values({ name: "mars", firstSeenAt: now, lastSeenAt: now })
      .returning()
      .get();
    const k2 = db
      .insert(disk)
      .values({
        alias: "K2",
        lastSeenAt: now,
        lastSeenHostId: mars.id,
        lastState: "spare",
      })
      .returning()
      .get();
    db.insert(diaryEntry)
      .values({
        subjectType: "disk",
        subjectId: k2.id,
        at: now,
        kind: "auto",
        eventType: "smart-status-changed",
        title: "failed (was passed)",
        data: { from: "passed", to: "failed" },
      })
      .run();

    await $fetch("/api/tasks", {
      method: "POST",
      body: { taskName: "alerts:tick" },
    });

    await vi.waitFor(
      async () => {
        const [latest] = await $fetch("/api/alerts");
        expect(latest).toMatchObject({
          channel: "webhook",
          rule: "disk-failed",
          message: "mars · K2: Failing (was healthy)",
          ok: true,
        });
      },
      { timeout: 5000, interval: 100 },
    );
    expect(JSON.parse(received.at(-1)?.body ?? "{}")).toMatchObject({
      rule: "disk-failed",
      severity: "alert",
      host: "mars",
    });
  });
});
