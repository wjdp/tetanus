import { readdirSync } from "node:fs";
import { join } from "node:path";
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

const UDEV_DIR = join(import.meta.dirname, "../fixtures/mars/udev");

async function ingest(source: string, body: string, device?: string) {
  const query = device ? `?device=${encodeURIComponent(device)}` : "";
  const response = await fetch(`/api/ingest/${source}${query}`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${enrolToken}`,
      [HOST_HEADER]: "mars",
      "content-type": "text/plain",
    },
    body,
  });
  expect(response.status).toBe(200);
}

type VdevNode = {
  name: string;
  type: string;
  disk: { alias: string | null } | null;
  children: VdevNode[];
};

function flatten(node: VdevNode): VdevNode[] {
  return [node, ...node.children.flatMap(flatten)];
}

beforeAll(async () => {
  await ingest("lsblk", readFixture("mars/lsblk.json"));
  for (const file of readdirSync(UDEV_DIR)) {
    const name = file.replace(/\.txt$/, "");
    await ingest(
      "udev",
      readFixture(`mars/udev/${file}`),
      name.slice(1).replace("-", ":"),
    );
  }
  await ingest("vdev-id-conf", readFixture("mars/vdev-id-conf.txt"));
  await ingest(
    "zpool-status",
    readFixture("mars/zpool-status-stored-paths.json"),
  );
  await ingest("zpool-list", readFixture("mars/zpool-list.json"));
  await ingest("zpool-events", readFixture("mars/zpool-events.txt"));
  await ingest("zpool-history", readFixture("mars/zpool-history.txt"));
});

describe("/api/pools", () => {
  it("lists pools with host, capacity and linked vdev tree", async () => {
    const pools = await (await fetch("/api/pools")).json();
    expect(pools.map((row: { name: string }) => row.name)).toEqual([
      "tank",
      "zeta",
    ]);
    expect(pools[0]).toMatchObject({
      name: "tank",
      state: "ONLINE",
      health: "ONLINE",
      cap: 63,
      host: { name: "mars" },
      scan: { function: "SCRUB", state: "FINISHED" },
      vdevs: { type: "root" },
    });
    const leaves = flatten(pools[0].vdevs).filter(
      (node) => node.type === "disk",
    );
    expect(leaves).toHaveLength(15);
    expect(leaves.map((node) => node.disk?.alias).sort()).toEqual([
      "K1",
      "K2",
      "K3",
      "K4",
      "K5",
      "K6",
      "L1",
      "L2",
      "L4",
      "M1",
      "M2",
      "M3",
      "Q1",
      "Q3",
      "Q4",
    ]);
  });

  it("gives each linked leaf its capacity, media, purpose, temperature and short model", async () => {
    const pools = await (await fetch("/api/pools")).json();
    const k1 = flatten(pools[0].vdevs).find(
      (node) => node.disk?.alias === "K1",
    )?.disk;
    expect(k1).toMatchObject({
      capacityBytes: expect.any(Number),
      media: "hdd",
      purpose: null,
      latestTemp: null,
      modelShort: expect.any(String),
      tempThresholds: { warning: 45, error: 55 },
    });
  });

  it("gets one pool with readings, history and events", async () => {
    const pools = await (await fetch("/api/pools")).json();
    const detail = await (await fetch(`/api/pools/${pools[0].id}`)).json();
    expect(detail).toMatchObject({
      id: pools[0].id,
      name: "tank",
      historyScope: "host",
      diary: [{ eventType: "scrub-finished" }],
      resolvedConfig: { scrubIntervalDays: 35, slowIoThreshold: 10 },
    });
    expect(detail.readings).toHaveLength(1);
    expect(detail.history).toHaveLength(50);
    expect(detail.events).toHaveLength(50);
  });

  it("404s for a missing pool", async () => {
    expect((await fetch("/api/pools/99999")).status).toBe(404);
  });
});
