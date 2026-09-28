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

function postEntry(body: unknown) {
  return fetch("/api/diary", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

type DiaryListing = { title: string; kind: string; subjectId: number | null };

describe("/api/diary", () => {
  it("adds manual entries and lists them newest first", async () => {
    const created = await postEntry({
      subjectType: "disk",
      subjectId: 7,
      title: "Taped pin 3",
      body: "Kapton",
      at: "2026-09-01T10:00:00Z",
    });
    expect(created.status).toBe(201);
    expect(await created.json()).toMatchObject({
      kind: "manual",
      subjectType: "disk",
      subjectId: 7,
      title: "Taped pin 3",
      at: "2026-09-01T10:00:00.000Z",
    });
    await postEntry({ subjectType: "system", title: "New HBA" });

    const all: DiaryListing[] = await (await fetch("/api/diary")).json();
    expect(all.map((entry) => entry.title)).toEqual(["New HBA", "Taped pin 3"]);

    const forDisk: DiaryListing[] = await (
      await fetch("/api/diary?subjectType=disk&subjectId=7&limit=10")
    ).json();
    expect(forDisk).toEqual([
      expect.objectContaining({ title: "Taped pin 3", kind: "manual" }),
    ]);
  });

  it("400s for an invalid entry or query", async () => {
    expect((await postEntry({ subjectType: "disk" })).status).toBe(400);
    expect((await postEntry({ subjectType: "cat", title: "x" })).status).toBe(
      400,
    );
    expect((await fetch("/api/diary?limit=0")).status).toBe(400);
  });
});

describe("/api/diary/:id", () => {
  function patchEntry(id: number, body: unknown) {
    return fetch(`/api/diary/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  function deleteEntry(id: number) {
    return fetch(`/api/diary/${id}`, { method: "DELETE" });
  }

  it("edits and deletes a manual entry", async () => {
    const { id } = await (
      await postEntry({ subjectType: "system", title: "Draft" })
    ).json();

    const patched = await patchEntry(id, {
      title: "Final",
      body: "See [the manual](https://example.com)",
      at: "2026-09-02T10:00:00Z",
    });
    expect(patched.status).toBe(200);
    expect(await patched.json()).toMatchObject({
      id,
      title: "Final",
      body: "See [the manual](https://example.com)",
      at: "2026-09-02T10:00:00.000Z",
    });

    expect((await deleteEntry(id)).status).toBe(204);
    expect((await deleteEntry(id)).status).toBe(404);
    expect((await patchEntry(id, { title: "x" })).status).toBe(404);
  });

  it("403s for auto entries", async () => {
    const { id } = sqlite
      .prepare(
        `INSERT INTO DiaryEntry (subjectType, subjectId, at, kind, eventType, title)
         VALUES ('disk', 1, 0, 'auto', 'moved-host', 'moved') RETURNING id`,
      )
      .get() as { id: number };
    expect((await patchEntry(id, { title: "x" })).status).toBe(403);
    expect((await deleteEntry(id)).status).toBe(403);
  });

  it("400s for an invalid patch", async () => {
    const { id } = await (
      await postEntry({ subjectType: "system", title: "Keep" })
    ).json();
    expect((await patchEntry(id, { title: "" })).status).toBe(400);
    expect((await patchEntry(id, { subjectType: "disk" })).status).toBe(400);
    expect((await fetch("/api/diary/abc", { method: "DELETE" })).status).toBe(
      400,
    );
  });
});
