import { $fetch, fetch, setup } from "@nuxt/test-utils/e2e";
import { afterAll, describe, expect, it } from "vitest";
import { APP_NAME } from "#shared/app";
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

interface WebAppManifest {
  name: string;
  icons: { src: string; sizes: string; purpose?: string }[];
}

describe("GET /manifest.webmanifest", () => {
  it("serves the manifest with its media type", async () => {
    const response = await fetch("/manifest.webmanifest");
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toMatch(
      /^application\/manifest\+json/,
    );
  });

  it("is named after the app", async () => {
    const manifest = await $fetch<WebAppManifest>("/manifest.webmanifest");
    expect(manifest.name).toBe(APP_NAME);
  });

  it("points at icons that exist", async () => {
    const manifest = await $fetch<WebAppManifest>("/manifest.webmanifest");
    expect(manifest.icons.some((icon) => icon.purpose === "maskable")).toBe(
      true,
    );
    for (const icon of manifest.icons) {
      const response = await fetch(icon.src);
      expect(response.status, icon.src).toBe(200);
      expect(response.headers.get("content-type")).toBe("image/png");
    }
  });
});
