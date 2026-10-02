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

function withAttributeRaw(body: string, attrId: number, raw: number) {
  const json = JSON.parse(body);
  const attribute = json.ata_smart_attributes.table.find(
    (row: { id: number }) => row.id === attrId,
  );
  attribute.raw = { value: raw, string: String(raw) };
  return JSON.stringify(json);
}

const K2_WITH_PENDING_SECTORS_ONLY = withAttributeRaw(
  readFixture("mars/smartctl/xall-sdb-auto.json"),
  198,
  0,
);

async function ingestK2(body: string) {
  const response = await fetch(
    "/api/ingest/smartctl-xall?device=/dev/sdb&exitStatus=0",
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${enrolToken}`,
        [HOST_HEADER]: "mars",
        "content-type": "text/plain",
      },
      body,
    },
  );
  expect(response.status).toBe(200);
}

function accept(diskId: number, body: unknown) {
  return fetch(`/api/disks/${diskId}/accept`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function clear(diskId: number, attrId: string) {
  return fetch(`/api/disks/${diskId}/accept/${attrId}`, { method: "DELETE" });
}

interface Overview {
  reading: { deviceStatus: string };
  attributes: {
    attrId: string;
    status: string;
    displayStatus: string;
    acceptance: { kind: string; acceptedValue: number; note: string } | null;
  }[];
  acceptances: { attrId: string; supersededAt: string | null }[];
  selfTests: unknown[];
}

async function overview(diskId: number): Promise<Overview> {
  return (await fetch(`/api/disks/${diskId}/smart`)).json();
}

async function diskStatus(diskId: number) {
  return (await (await fetch(`/api/disks/${diskId}`)).json()).latestStatus;
}

function attribute197(smart: Overview) {
  return smart.attributes.find((candidate) => candidate.attrId === "197");
}

await ingestK2(K2_WITH_PENDING_SECTORS_ONLY);
const diskId = (
  sqlite
    .prepare("SELECT id FROM Disk WHERE serial = ?")
    .get(JSON.parse(K2_WITH_PENDING_SECTORS_ONLY).serial_number) as {
    id: number;
  }
).id;

describe("/api/disks/:id/accept", () => {
  it("accepts K2's pending sectors and drops the disk from failed", async () => {
    expect(await diskStatus(diskId)).toBe("failed");

    const response = await accept(diskId, {
      attrId: "197",
      note: "16 since purchase",
    });
    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({
      diskId,
      attrId: "197",
      kind: "accept",
      acceptedValue: 16,
      note: "16 since purchase",
      supersededAt: null,
      clearedAt: null,
    });

    const smart = await overview(diskId);
    expect(attribute197(smart)).toMatchObject({
      status: "failed",
      displayStatus: "accepted",
      acceptance: { acceptedValue: 16, note: "16 since purchase" },
    });
    expect(smart.reading.deviceStatus).not.toBe("failed");
    expect(await diskStatus(diskId)).toBe(smart.reading.deviceStatus);
    expect(smart.acceptances).toHaveLength(1);
    expect(Array.isArray(smart.selfTests)).toBe(true);
  });

  it("409s for a second acceptance and 404s for an unknown attribute", async () => {
    expect((await accept(diskId, { attrId: "197" })).status).toBe(409);
    expect((await accept(diskId, { attrId: "999" })).status).toBe(404);
    expect((await accept(99999, { attrId: "197" })).status).toBe(404);
    expect((await accept(diskId, {})).status).toBe(400);
    expect(
      (await accept(diskId, { attrId: "197", kind: "ignore" })).status,
    ).toBe(400);
  });

  it("clears the acceptance back to failed", async () => {
    const response = await clear(diskId, "197");
    expect(response.status).toBe(200);
    expect((await response.json()).clearedAt).toEqual(expect.any(String));

    expect(attribute197(await overview(diskId))).toMatchObject({
      displayStatus: "failed",
      acceptance: null,
    });
    expect(await diskStatus(diskId)).toBe("failed");
    expect((await clear(diskId, "197")).status).toBe(404);
  });

  it("supersedes the acceptance when the value rises", async () => {
    expect((await accept(diskId, { attrId: "197" })).status).toBe(201);
    expect(await diskStatus(diskId)).not.toBe("failed");

    await ingestK2(withAttributeRaw(K2_WITH_PENDING_SECTORS_ONLY, 197, 24));

    const smart = await overview(diskId);
    expect(attribute197(smart)).toMatchObject({
      displayStatus: "failed",
      acceptance: null,
    });
    expect(smart.acceptances[0]).toMatchObject({
      attrId: "197",
      supersededAt: expect.any(String),
    });
    expect(await diskStatus(diskId)).toBe("failed");

    const diary: { eventType: string | null }[] = await (
      await fetch(`/api/diary?subjectType=disk&subjectId=${diskId}`)
    ).json();
    expect(diary.map((entry) => entry.eventType)).toEqual(
      expect.arrayContaining([
        "fault-accepted",
        "acceptance-cleared",
        "acceptance-superseded",
      ]),
    );
  });

  it("acknowledges the fault as a warning until the value rises again", async () => {
    const response = await accept(diskId, {
      attrId: "197",
      kind: "acknowledge",
    });
    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({
      kind: "acknowledge",
      acceptedValue: 24,
    });
    expect(attribute197(await overview(diskId))).toMatchObject({
      displayStatus: "acknowledged",
      acceptance: { kind: "acknowledge", acceptedValue: 24 },
    });
    expect(await diskStatus(diskId)).toBe("warning");

    await ingestK2(withAttributeRaw(K2_WITH_PENDING_SECTORS_ONLY, 197, 25));

    expect(attribute197(await overview(diskId))).toMatchObject({
      displayStatus: "failed",
      acceptance: null,
    });
    expect(await diskStatus(diskId)).toBe("failed");
  });
});
