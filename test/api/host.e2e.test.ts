import { readFileSync } from "node:fs";
import { fetch, setup } from "@nuxt/test-utils/e2e";
import { afterAll, describe, expect, it } from "vitest";
import { createDb } from "~~/server/database/client";
import { runMigrations } from "~~/server/database/migrate";
import { host } from "~~/server/database/schema";
import { createTestDatabaseFile, startNuxtServer } from "./devServer";

const databaseFile = createTestDatabaseFile();
const { sqlite, db } = createDb(databaseFile);
runMigrations(sqlite, db);
const seenAt = new Date();
const { id: marsId } = db
  .insert(host)
  .values({ name: "mars", firstSeenAt: seenAt, lastSeenAt: seenAt })
  .returning({ id: host.id })
  .get();
sqlite.close();

const server = await startNuxtServer(databaseFile);
afterAll(() => server.stop());

await setup({ host: server.host });

const hostFile = (path: string) =>
  readFileSync(new URL(`../../host/${path}`, import.meta.url), "utf8");

describe("GET /host/:path", () => {
  it.each([
    "install.sh",
    "tetanus-collect",
    "tetanus-collect@.service",
    "tetanus-collect-zfs.timer",
    "zed/all-tetanus.sh",
  ])("serves %s as it is in host/", async (path) => {
    const response = await fetch(`/host/${path}`);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/plain");
    expect(await response.text()).toBe(hostFile(path));
  });

  it.each(["README.md", "test/run.sh", "../package.json"])(
    "does not serve %s",
    async (path) => {
      expect((await fetch(`/host/${path}`)).status).toBe(404);
    },
  );
});

describe("PATCH /api/hosts/:id temperature thresholds", () => {
  const hostPath = `/api/hosts/${marsId}`;
  const patch = (body: unknown) =>
    fetch(hostPath, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });

  it("round-trips per-media thresholds", async () => {
    const temperatureThresholds = {
      hdd: { warning: 50, error: 60 },
      ssd: { warning: 65, error: 75 },
    };
    const patched = await patch({ temperatureThresholds });
    expect(patched.status).toBe(200);
    expect(await patched.json()).toMatchObject({ temperatureThresholds });
    expect(await (await fetch(hostPath)).json()).toMatchObject({
      temperatureThresholds,
    });
  });

  it("clears thresholds with null", async () => {
    await patch({ temperatureThresholds: { hdd: { warning: 50, error: 60 } } });
    await patch({ temperatureThresholds: null });
    expect(await (await fetch(hostPath)).json()).toMatchObject({
      temperatureThresholds: null,
    });
  });

  it("rejects a warning above the error threshold", async () => {
    const response = await patch({
      temperatureThresholds: { hdd: { warning: 60, error: 50 } },
    });
    expect(response.status).toBe(400);
  });
});
