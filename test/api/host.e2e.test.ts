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
const insertHost = (name: string) =>
  db
    .insert(host)
    .values({ name, firstSeenAt: seenAt, lastSeenAt: seenAt })
    .returning({ id: host.id })
    .get().id;
const marsId = insertHost("mars");
const venusId = insertHost("venus");
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

describe("PATCH /api/hosts/:id intermittent", () => {
  const hostPath = `/api/hosts/${venusId}`;
  const patch = (body: unknown) =>
    fetch(hostPath, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });

  it("round-trips the flag", async () => {
    expect((await patch({ intermittent: true })).status).toBe(200);
    expect(await (await fetch(hostPath)).json()).toMatchObject({
      intermittent: true,
    });
    await patch({ intermittent: false });
    expect(await (await fetch(hostPath)).json()).toMatchObject({
      intermittent: false,
    });
  });

  it("rejects a Healthchecks URL while intermittent", async () => {
    await patch({ intermittent: true });
    const response = await patch({ healthchecksUrl: "https://hc-ping.com/x" });
    expect(response.status).toBe(400);
    await patch({ intermittent: false });
  });
});

describe("PUT /api/hosts/order", () => {
  const putOrder = (hostIds: number[]) =>
    fetch("/api/hosts/order", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ hostIds }),
    });
  const listedIds = async () =>
    ((await (await fetch("/api/hosts")).json()) as { id: number }[]).map(
      (row) => row.id,
    );

  it("changes the listed order", async () => {
    expect((await putOrder([venusId, marsId])).status).toBe(200);
    expect(await listedIds()).toEqual([venusId, marsId]);
    await putOrder([marsId, venusId]);
    expect(await listedIds()).toEqual([marsId, venusId]);
  });

  it("rejects a partial list", async () => {
    expect((await putOrder([marsId])).status).toBe(400);
  });
});
