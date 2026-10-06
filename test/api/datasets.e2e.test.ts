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

const UTN = "tank/anup07rl/t8a/diti/utn";

async function ingest(source: string, body: string) {
  const response = await fetch(`/api/ingest/${source}`, {
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

type PoolListing = {
  id: number;
  name: string;
  datasetCount: number;
  snapshotCount: number;
};
type DatasetListing = { id: number; name: string; depth: number };

async function tankPool(): Promise<PoolListing> {
  const pools: PoolListing[] = await (await fetch("/api/pools")).json();
  const tank = pools.find((row) => row.name === "tank");
  if (!tank) throw new Error("tank not ingested");
  return tank;
}

async function utnDataset(): Promise<DatasetListing> {
  const { datasets } = await (
    await fetch(`/api/datasets?q=${encodeURIComponent(UTN)}`)
  ).json();
  return datasets[0];
}

beforeAll(async () => {
  await ingest(
    "zpool-status",
    readFixture("mars/zpool-status-stored-paths.json"),
  );
  await ingest("zfs-list", readFixture("mars/zfs-list.json"));
  await ingest("zfs-snapshots", readFixture("mars/zfs-snapshots.json"));
});

describe("/api/pools/:id/datasets", () => {
  it("adds dataset and snapshot counts to the pool list and detail", async () => {
    const tank = await tankPool();
    expect(tank).toMatchObject({ datasetCount: 80, snapshotCount: 193 });
    const detail = await (await fetch(`/api/pools/${tank.id}`)).json();
    expect(detail).toMatchObject({ datasetCount: 80, snapshotCount: 193 });
  });

  it("lists the pool's datasets in tree order", async () => {
    const tank = await tankPool();
    const { datasets } = await (
      await fetch(`/api/pools/${tank.id}/datasets`)
    ).json();
    expect(datasets).toHaveLength(80);
    expect(datasets[0]).toMatchObject({
      name: "tank",
      depth: 0,
      parentId: null,
      present: true,
      growth: null,
    });
    expect(
      datasets.find((row: DatasetListing) => row.name === UTN),
    ).toMatchObject({ depth: 4, snapshotCount: 50 });
  });

  it("404s for a missing pool", async () => {
    expect((await fetch("/api/pools/99999/datasets")).status).toBe(404);
  });
});

describe("/api/datasets", () => {
  it("searches datasets by name", async () => {
    const response = await fetch("/api/datasets?q=DITI/");
    expect(response.status).toBe(200);
    const { datasets } = await response.json();
    expect(datasets).toHaveLength(5);
    expect(datasets[0]).toMatchObject({
      name: "tank/anup07rl/t8a/diti/cflkg",
      pool: { name: "tank" },
      host: { name: "mars", displayName: null },
    });
  });

  it("caps search results at 20", async () => {
    const { datasets } = await (await fetch("/api/datasets?q=tank")).json();
    expect(datasets).toHaveLength(20);
  });

  it("looks up datasets by ids", async () => {
    const { datasets: found } = await (
      await fetch("/api/datasets?q=DITI/")
    ).json();
    const ids = found.slice(0, 2).map((row: { id: number }) => row.id);
    const { datasets } = await (
      await fetch(`/api/datasets?ids=${ids.join(",")}`)
    ).json();
    expect(datasets.map((row: { id: number }) => row.id)).toEqual(ids);
    expect((await fetch("/api/datasets?ids=x")).status).toBe(400);
  });

  it("400s without a query", async () => {
    expect((await fetch("/api/datasets")).status).toBe(400);
    expect((await fetch("/api/datasets?q=")).status).toBe(400);
    expect((await fetch(`/api/datasets?q=${"a".repeat(101)}`)).status).toBe(
      400,
    );
  });

  it("gets one dataset with its snapshots", async () => {
    const utn = await utnDataset();
    const detail = await (await fetch(`/api/datasets/${utn.id}`)).json();
    expect(detail).toMatchObject({
      id: utn.id,
      name: UTN,
      depth: 4,
      pool: { name: "tank" },
      host: { name: "mars" },
      children: [],
      diary: [],
      replications: [],
    });
    expect(detail.snapshots).toHaveLength(50);
    expect(detail.snapshots[0].ageMs).toBeGreaterThan(0);
    expect(detail.readings).toHaveLength(1);
  });

  it("404s for a missing dataset", async () => {
    expect((await fetch("/api/datasets/99999")).status).toBe(404);
  });

  it("records and lists diary entries on a dataset", async () => {
    const utn = await utnDataset();
    const created = await fetch("/api/diary", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        subjectType: "dataset",
        subjectId: utn.id,
        title: "Raised quota",
      }),
    });
    expect(created.status).toBe(201);

    const listed = await (
      await fetch(`/api/diary?subjectType=dataset&subjectId=${utn.id}`)
    ).json();
    expect(listed).toEqual([
      expect.objectContaining({
        title: "Raised quota",
        subjectType: "dataset",
      }),
    ]);
    const detail = await (await fetch(`/api/datasets/${utn.id}`)).json();
    expect(detail.diary).toEqual([
      expect.objectContaining({ title: "Raised quota" }),
    ]);
  });
});

describe("name-based paths", () => {
  it("resolves a pool and its datasets by host and name", async () => {
    const tank = await tankPool();
    const pool = await (await fetch("/api/zfs/mars/tank")).json();
    expect(pool).toMatchObject({
      kind: "pool",
      pool: { id: tank.id, path: "/zfs/mars/tank" },
    });

    const root = await (await fetch("/api/zfs/mars/tank/~root")).json();
    expect(root).toMatchObject({ kind: "dataset", dataset: { name: "tank" } });

    const utn = await (await fetch(`/api/zfs/mars/${UTN}`)).json();
    expect(utn).toMatchObject({
      kind: "dataset",
      dataset: { id: (await utnDataset()).id, name: UTN },
    });

    expect((await fetch("/api/zfs/mars/tank/missing")).status).toBe(404);
  });

  it("finds a host by name", async () => {
    const host = await (await fetch("/api/hosts/by-name/mars")).json();
    expect(host).toMatchObject({ name: "mars" });
    expect((await fetch("/api/hosts/by-name/nowhere")).status).toBe(404);
  });

  it("redirects old id URLs to the name-based path", async () => {
    const tank = await tankPool();
    const pool = await fetch(`/zfs/${tank.id}?tab=x`, { redirect: "manual" });
    expect(pool.status).toBe(302);
    expect(pool.headers.get("location")).toBe("/zfs/mars/tank?tab=x");

    const dataset = await fetch(`/datasets/${(await utnDataset()).id}`, {
      redirect: "manual",
    });
    expect(dataset.headers.get("location")).toBe(`/zfs/mars/${UTN}`);
  });
});
