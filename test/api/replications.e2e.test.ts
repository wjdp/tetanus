import { fetch, setup } from "@nuxt/test-utils/e2e";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb } from "~~/server/database/client";
import { runMigrations } from "~~/server/database/migrate";
import { dataset, host, pool, snapshot } from "~~/server/database/schema";
import { HOST_HEADER } from "~~/shared/ingest";
import type { ReplicationRow } from "~~/shared/replications";
import type { Settings } from "~~/shared/schemas/settings";
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

const HOUR_MS = 60 * 60 * 1000;
const now = Date.now();
const hoursAgo = (hours: number) => new Date(now - hours * HOUR_MS);

function insertDataset(poolId: number, name: string) {
  return db
    .insert(dataset)
    .values({
      poolId,
      name,
      type: "filesystem",
      used: 0,
      referenced: 0,
      available: 0,
      creation: hoursAgo(100),
      firstSeenAt: hoursAgo(100),
      lastSeenAt: hoursAgo(1),
    })
    .returning()
    .get().id;
}

function insertPool(hostName: string, name: string) {
  const hostId = db
    .insert(host)
    .values({
      name: hostName,
      firstSeenAt: hoursAgo(100),
      lastSeenAt: hoursAgo(0),
    })
    .returning()
    .get().id;
  return db
    .insert(pool)
    .values({
      hostId,
      guid: `${hostName}-${name}`,
      name,
      state: "ONLINE",
      firstSeenAt: hoursAgo(100),
      lastSeenAt: hoursAgo(1),
    })
    .returning()
    .get().id;
}

function insertSnapshot(datasetId: number, name: string, guid: string) {
  db.insert(snapshot)
    .values({
      datasetId,
      name,
      guid,
      used: 0,
      referenced: 0,
      written: 0,
      creation: hoursAgo(1),
      lastSeenAt: hoursAgo(1),
    })
    .run();
}

const historyTimestamp = (date: Date) =>
  date.toISOString().slice(0, 19).replace("T", ".");

const receivesBody = [
  "History for 'vpool':",
  ...[3, 2, 1].flatMap((hours) => [
    `${historyTimestamp(hoursAgo(hours))} [txg:${hours}] finish receiving vpool/tank/a/%recv (1) snap=syncoid_vault_${hours} [on vault]`,
    `${historyTimestamp(hoursAgo(hours))} zfs receive -s -F vpool/tank/a [user 0 (root) on vault:linux]`,
  ]),
].join("\n");

let tankPoolId = 0;
let sourceId = 0;
let targetId = 0;

beforeAll(async () => {
  tankPoolId = insertPool("mars", "tank");
  sourceId = insertDataset(tankPoolId, "tank/a");
  targetId = insertDataset(insertPool("vault", "vpool"), "vpool/tank/a");
  insertSnapshot(sourceId, "syncoid_vault_1", "9001");
  insertSnapshot(targetId, "syncoid_vault_1", "9001");
  const response = await fetch("/api/ingest/zfs-receives", {
    method: "POST",
    headers: {
      authorization: `Bearer ${enrolToken}`,
      [HOST_HEADER]: "vault",
      "content-type": "text/plain",
    },
    body: receivesBody,
  });
  expect(response.status).toBe(200);
});

async function onlyReplication(): Promise<ReplicationRow> {
  const rows: ReplicationRow[] = await (
    await fetch("/api/replications")
  ).json();
  expect(rows).toHaveLength(1);
  return rows[0] as ReplicationRow;
}

describe("/api/replications", () => {
  it("lists the replication discovered from receive history", async () => {
    expect(await onlyReplication()).toMatchObject({
      source: { host: { name: "mars" }, dataset: { id: sourceId } },
      target: {
        host: { name: "vault" },
        pool: { name: "vpool" },
        dataset: { id: targetId, name: "vpool/tank/a" },
      },
      direction: "received",
      status: "ok",
      intervalSec: 3600,
      intervalManual: false,
      lastSyncAt: hoursAgo(1)
        .toISOString()
        .replace(/\.\d+Z$/, ".000Z"),
      syncCount: 3,
      archivedAt: null,
    });
  });

  it("gets one replication with its syncs, ladder and diary", async () => {
    const { id } = await onlyReplication();
    const detail = await (await fetch(`/api/replications/${id}`)).json();
    expect(detail.syncs).toMatchObject({ total: 3, page: 1, pageSize: 100 });
    expect(detail.syncs.items[0]).toMatchObject({
      snapshotName: "syncoid_vault_1",
      guid: "9001",
      snapshots: 1,
    });
    expect(detail.ladder).toEqual([
      expect.objectContaining({
        guid: "9001",
        source: expect.objectContaining({ name: "syncoid_vault_1" }),
        target: expect.objectContaining({ name: "syncoid_vault_1" }),
      }),
    ]);
    expect(detail.faults).toEqual([]);
    expect(detail.diary).toEqual([
      expect.objectContaining({ eventType: "replication-discovered" }),
    ]);
  });

  it("404s for a missing replication and 400s for a bad page", async () => {
    expect((await fetch("/api/replications/99999")).status).toBe(404);
    const { id } = await onlyReplication();
    expect((await fetch(`/api/replications/${id}?page=0`)).status).toBe(400);
  });
});

describe("/api/pools/:id/datasets replications", () => {
  it("marks each dataset's replications with role and status", async () => {
    const { id } = await onlyReplication();
    const { datasets } = await (
      await fetch(`/api/pools/${tankPoolId}/datasets`)
    ).json();
    expect(datasets).toEqual([
      expect.objectContaining({
        id: sourceId,
        replications: [{ id, role: "source", status: "ok" }],
      }),
    ]);
  });
});

describe("PATCH /api/replications/:id", () => {
  const patch = (id: number, body: unknown) =>
    fetch(`/api/replications/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });

  it("overrides the interval and archives with a note", async () => {
    const { id } = await onlyReplication();
    const interval = await patch(id, { manualIntervalSec: 7200 });
    expect(interval.status).toBe(200);
    expect(await interval.json()).toMatchObject({
      intervalSec: 7200,
      intervalManual: true,
    });

    const archived = await patch(id, {
      archived: true,
      archivedNote: "retired",
    });
    expect(await archived.json()).toMatchObject({
      status: "archived",
      archivedNote: "retired",
    });
    expect(await onlyReplication()).toMatchObject({ status: "archived" });
  });

  it("400s for a bad patch and 404s for a missing replication", async () => {
    const { id } = await onlyReplication();
    expect((await patch(id, { archivedNote: "x" })).status).toBe(400);
    expect((await patch(id, { bogus: true })).status).toBe(400);
    expect((await patch(id, { sourceDatasetId: 99999 })).status).toBe(400);
    expect((await patch(99999, { archived: true })).status).toBe(404);
  });
});
