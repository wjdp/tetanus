import { fetch, setup } from "@nuxt/test-utils/e2e";
import { afterAll, describe, expect, it } from "vitest";
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

const SDA = readFixture("mars/smartctl/xall-sda-auto.json");

function ingestSmartctl(body: string) {
  return fetch("/api/ingest/smartctl-xall?device=/dev/sda&exitStatus=0", {
    method: "POST",
    headers: {
      authorization: `Bearer ${enrolToken}`,
      [HOST_HEADER]: "mars",
      "content-type": "text/plain",
    },
    body,
  });
}

function diskIdBySerial(serial: string) {
  return (
    sqlite.prepare("SELECT id FROM Disk WHERE serial = ?").get(serial) as {
      id: number;
    }
  ).id;
}

describe("/api/disks/:id/smart", () => {
  it("returns the latest reading, attributes and history after ingest", async () => {
    expect((await ingestSmartctl(SDA)).status).toBe(200);
    const id = diskIdBySerial(JSON.parse(SDA).serial_number);

    const response = await fetch(`/api/disks/${id}/smart?range=7d`);
    expect(response.status).toBe(200);
    const smart = await response.json();

    expect(smart.reading).toMatchObject({
      diskId: id,
      devicePath: "/dev/sda",
      deviceStatus: "passed",
      temp: 40,
    });
    expect(smart.attributes).toHaveLength(19);
    expect(smart.attributes).toContainEqual(
      expect.objectContaining({ attrId: "187", source: "device-statistics" }),
    );
    expect(smart.attributes).toContainEqual(
      expect.objectContaining({
        attrId: "5",
        name: "Reallocated Sectors Count",
        trend: "new",
        displayStatus: "passed",
        acceptance: null,
        metadata: expect.objectContaining({ ideal: "low", critical: true }),
        statusChanges: [],
        statusSince: null,
        valueSince: expect.any(String),
        firstNonZeroAt: null,
      }),
    );
    expect(smart.history.attributes["194"]).toEqual([
      { at: expect.any(String), value: 40 },
    ]);
    expect(smart.history.temperature.length).toBeGreaterThan(100);
    expect(smart.acceptances).toEqual([]);
    expect(Array.isArray(smart.selfTests)).toBe(true);

    const detail = await (await fetch(`/api/disks/${id}`)).json();
    expect(detail).toMatchObject({ latestStatus: "passed", latestTemp: 40 });
  });

  it("400s for an unknown range", async () => {
    expect((await fetch("/api/disks/1/smart?range=2w")).status).toBe(400);
  });

  it("404s for a missing disk", async () => {
    expect((await fetch("/api/disks/99999/smart")).status).toBe(404);
  });
});
