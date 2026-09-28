import { fetch, setup } from "@nuxt/test-utils/e2e";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb } from "~~/server/database/client";
import { runMigrations } from "~~/server/database/migrate";
import { HOST_HEADER } from "~~/shared/ingest";
import type { Settings } from "~~/shared/schemas/settings";
import { readFixture } from "~~/test/fixtures";
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

const { enrolToken }: Settings = await (await fetch("/api/settings")).json();

function ingest(source: string, body: string, device?: string) {
  const query = device ? `?device=${encodeURIComponent(device)}` : "";
  return fetch(`/api/ingest/${source}${query}`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${enrolToken}`,
      [HOST_HEADER]: "mars",
      "content-type": "text/plain",
    },
    body,
  });
}

function patchDisk(id: number, body: unknown) {
  return fetch(`/api/disks/${id}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

type DiskListing = {
  id: number;
  alias: string | null;
  serial: string | null;
  state: string;
  hostName: string | null;
  keys: { kind: string; value: string }[];
};

function diskIdBySerial(serial: string) {
  return (
    sqlite.prepare("SELECT id FROM Disk WHERE serial = ?").get(serial) as {
      id: number;
    }
  ).id;
}

beforeAll(async () => {
  expect((await ingest("lsblk", readFixture("mars/lsblk.json"))).status).toBe(
    200,
  );
  for (const name of ["b8-0", "b8-16", "b8-17"]) {
    const response = await ingest(
      "udev",
      readFixture(`mars/udev/${name}.txt`),
      name.slice(1).replace("-", ":"),
    );
    expect(response.status).toBe(200);
  }
  expect(
    (await ingest("vdev-id-conf", readFixture("mars/vdev-id-conf.txt"))).status,
  ).toBe(200);
});

describe("/api/disks", () => {
  it("lists disks with keys, host and state", async () => {
    const disks: DiskListing[] = await (await fetch("/api/disks")).json();
    expect(disks).toHaveLength(20);
    expect(disks[0]).toMatchObject({
      alias: "K1",
      serial: "0UTY8HTE",
      state: "spare",
      hostName: "mars",
    });
    expect(disks[0].keys).toContainEqual({
      kind: "by-id",
      value: "wwn-0x5000cca5f853b4e6",
    });
  });

  it("gets one disk with keys and diary", async () => {
    const id = diskIdBySerial("1AQLP5ME");
    const detail = await (await fetch(`/api/disks/${id}`)).json();
    expect(detail).toMatchObject({ id, alias: "K2" });
    expect(detail.keys.length).toBeGreaterThan(2);
    expect(detail.diary).toEqual([
      expect.objectContaining({ eventType: "alias-set" }),
    ]);
  });

  it("404s for a missing disk", async () => {
    expect((await fetch("/api/disks/99999")).status).toBe(404);
  });

  it("patches inventory, notes, alias and override", async () => {
    const id = diskIdBySerial("0UTY8HTE");
    const response = await patchDisk(id, {
      alias: "K7",
      notes: "Top bay",
      stateOverride: "retired",
      inventory: { purchaseDate: "2024-01-02", pin33Taped: true },
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      alias: "K7",
      notes: "Top bay",
      state: "retired",
      inventory: { purchaseDate: "2024-01-02", pin33Taped: true },
      ageDays: expect.any(Number),
    });
  });

  it("409s on an alias clash", async () => {
    const response = await patchDisk(diskIdBySerial("0UTY8HTE"), {
      alias: "K2",
    });
    expect(response.status).toBe(409);
  });

  it("400s for invalid inventory", async () => {
    const id = diskIdBySerial("0UTY8HTE");
    const badDate = await patchDisk(id, {
      inventory: { purchaseDate: "yesterday" },
    });
    expect(badDate.status).toBe(400);
    const unknownField = await patchDisk(id, { inventory: { colour: "red" } });
    expect(unknownField.status).toBe(400);
  });
});
