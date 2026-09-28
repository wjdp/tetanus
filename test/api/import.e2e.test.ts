import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { fetch, setup } from "@nuxt/test-utils/e2e";
import { afterAll, describe, expect, it, vi } from "vitest";
import type { ScrutinyImportResult } from "#shared/schemas/import";
import type { SseTask } from "#shared/sse";
import { createDb } from "~~/server/database/client";
import { runMigrations } from "~~/server/database/migrate";
import { host } from "~~/server/database/schema";
import {
  ATA_KEY,
  scrutinyFixtureFetch,
} from "~~/server/services/importers/scrutinyFixtureFetch";
import { createTestDatabaseFile, startNuxtServer } from "./devServer";

const databaseFile = createTestDatabaseFile();
const { sqlite, db } = createDb(databaseFile);
runMigrations(sqlite, db);

const serveFixture = scrutinyFixtureFetch();
const scrutiny = createServer(async (request, response) => {
  const fixture = await serveFixture(`http://scrutiny.test${request.url}`);
  response.writeHead(fixture.status, { "content-type": "application/json" });
  response.end(await fixture.text());
});
await new Promise<void>((resolve) => scrutiny.listen(0, "127.0.0.1", resolve));
const scrutinyUrl = `http://127.0.0.1:${(scrutiny.address() as AddressInfo).port}`;

const server = await startNuxtServer(databaseFile);
afterAll(() => {
  server.stop();
  scrutiny.close();
  sqlite.close();
});

await setup({ host: server.host });

const now = new Date();
const mars = db
  .insert(host)
  .values({ name: "mars", firstSeenAt: now, lastSeenAt: now })
  .returning()
  .get();

// Raw SQL: selecting through Drizzle's Disk types here tips nuxt typecheck
// into TS2321 on Nitro's route matching elsewhere.
function countDisks() {
  return (
    sqlite.prepare("SELECT count(*) AS n FROM Disk").get() as { n: number }
  ).n;
}

function postImport(body: unknown) {
  return fetch("/api/import/scrutiny", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/import/scrutiny", () => {
  it.each([
    {},
    { url: "ftp://scrutiny.test", hostId: 1, dryRun: true },
    { url: scrutinyUrl, hostId: 0, dryRun: true },
    { url: scrutinyUrl, hostId: 1 },
  ])("400s for %o", async (body) => {
    expect((await postImport(body)).status).toBe(400);
  });

  it("502s when scrutiny is unreachable", async () => {
    const response = await postImport({
      url: "http://127.0.0.1:1",
      hostId: mars.id,
      dryRun: true,
    });
    expect(response.status).toBe(502);
  });

  it("404s for an unknown host", async () => {
    const response = await postImport({
      url: scrutinyUrl,
      hostId: 9999,
      dryRun: false,
    });
    expect(response.status).toBe(404);
  });

  it("previews the import without writing", async () => {
    const response = await postImport({
      url: scrutinyUrl,
      hostId: mars.id,
      dryRun: true,
    });

    expect(response.status).toBe(200);
    const preview = await response.json();
    expect(preview.dryRun).toBe(true);
    expect(preview.devices).toHaveLength(3);
    expect(preview.devices).toContainEqual(
      expect.objectContaining({ key: ATA_KEY, matched: "created" }),
    );
    expect(countDisks()).toBe(0);
  });

  it("enqueues the import and stores its summary on the task", async () => {
    const response = await postImport({
      url: scrutinyUrl,
      hostId: mars.id,
      dryRun: false,
    });

    const { taskId } = await response.json();
    expect(taskId).toEqual(expect.any(Number));
    await vi.waitFor(
      async () => {
        const tasks: SseTask[] = await (await fetch("/api/tasks")).json();
        const task = tasks.find((candidate) => candidate.id === taskId);
        expect(task).toMatchObject({
          name: "import:scrutiny",
          state: "done",
          payload: { url: scrutinyUrl, hostId: mars.id },
        });
      },
      { timeout: 10000, interval: 100 },
    );
    const result: ScrutinyImportResult<string> = await (
      await fetch(`/api/import/scrutiny/${taskId}`)
    ).json();
    expect(result.dryRun).toBe(false);
    expect(result.devices.map((device) => device.matched)).toEqual([
      "created",
      "created",
      "created",
    ]);
    expect(countDisks()).toBe(3);
  });

  it("404s for a task without a scrutiny result", async () => {
    expect((await fetch("/api/import/scrutiny/9999")).status).toBe(404);
  });
});
