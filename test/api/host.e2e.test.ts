import { readFileSync } from "node:fs";
import { fetch, setup } from "@nuxt/test-utils/e2e";
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
