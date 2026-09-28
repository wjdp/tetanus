import { fetch, setup } from "@nuxt/test-utils/e2e";
import { afterAll, describe, expect, it } from "vitest";
import { createDb } from "~~/server/database/client";
import { runMigrations } from "~~/server/database/migrate";
import { createTestDatabaseFile, startNuxtServer } from "./devServer";

const databaseFile = createTestDatabaseFile();
const { sqlite, db } = createDb(databaseFile);
runMigrations(sqlite, db);

const server = await startNuxtServer(databaseFile);
afterAll(() => {
  server.stop();
  sqlite.close();
});

await setup({ host: server.host });

function postImport(body: unknown) {
  return fetch("/api/import/obsidian", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const TABLE = [
  "| Alias | Serial | Capacity | Status | Purchased |",
  "| --- | --- | --- | --- | --- |",
  "| H1 | WD-WCC4E0000001 | 4TB | REMOVED | 2018-06-01 |",
  "| H2 | WD-WCC4E0000002 | 4TB | ONLINE | 2018-06-01 |",
].join("\n");

type DiskListing = { alias: string | null; state: string; lastSeenAt: null };

describe("/api/import/obsidian", () => {
  it("previews without writing, then imports", async () => {
    const preview = await postImport({ text: TABLE, dryRun: true });
    expect(preview.status).toBe(200);
    expect(await preview.json()).toMatchObject({
      dryRun: true,
      columns: { alias: "Alias", serial: "Serial", status: "Status" },
      created: [
        { row: 1, alias: "H1" },
        { row: 2, alias: "H2" },
      ],
      matched: [],
      skipped: [],
    });
    expect(await (await fetch("/api/disks")).json()).toEqual([]);

    const imported = await postImport({ text: TABLE, dryRun: false });
    expect(imported.status).toBe(200);
    expect((await imported.json()).created).toHaveLength(2);

    const disks: DiskListing[] = await (await fetch("/api/disks")).json();
    expect(disks).toMatchObject([
      { alias: "H1", state: "removed", lastSeenAt: null },
      { alias: "H2", state: "unseen", lastSeenAt: null },
    ]);
  });

  it("422s for a table it cannot match on", async () => {
    const response = await postImport({ text: "model\nX\n", dryRun: true });
    expect(response.status).toBe(422);
  });

  it("400s for a malformed body", async () => {
    expect((await postImport({ text: TABLE })).status).toBe(400);
  });
});
