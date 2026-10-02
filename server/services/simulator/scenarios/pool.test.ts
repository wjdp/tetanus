import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { seed } from "~~/server/demo/seed";
import { DEMO_EPOCH, HOUR_MS } from "~~/server/demo/timeline";
import { listFaults } from "~~/server/services/faults";
import { getPool, listPools, type PoolDetail } from "~~/server/services/zfs";
import { dumpDatabase } from "~~/test/db";
import { restore, simulate, subjectScenarios } from "../run";

const NOW = new Date(DEMO_EPOCH.getTime() + 2 * HOUR_MS);
const LATER = new Date(NOW.getTime() + 10 * 60 * 1000);

let pristine: ReturnType<typeof dumpDatabase>;

function poolId(host: string, name: string) {
  const found = listPools().find(
    (row) => row.host.name === host && row.name === name,
  );
  if (!found) throw new Error(`No pool ${host}/${name}`);
  return found.id;
}

const liveFaults = (id: number) =>
  listFaults({ state: ["open", "acknowledged"] }).faults.filter(
    (fault) => fault.subject.type === "pool" && fault.subject.id === id,
  );

function flatten(node: ReturnType<typeof getPool>["vdevs"]) {
  if (!node) return [];
  const nodes = [node];
  for (const child of node.children) nodes.push(...flatten(child));
  return nodes;
}

beforeAll(async () => {
  await seed(NOW, { replay: "short" });
  pristine = dumpDatabase();
}, 120_000);

afterEach(() => {
  restore();
  expect(dumpDatabase()).toEqual(pristine);
});

describe("pool scenarios", () => {
  it("offers spares only to pools with spares", () => {
    const ids = (id: number) =>
      subjectScenarios("pool", id).scenarios.map((scenario) => scenario.id);
    expect(ids(poolId("styx", "vault"))).toContain("spare-in-use");
    expect(ids(poolId("atlas", "tank"))).not.toContain("spare-in-use");
    expect(ids(poolId("atlas", "tank"))).toEqual(
      expect.arrayContaining(["leaf-fails", "nearly-full", "error-burst"]),
    );
  });

  it("degrades the pool when a leaf fails", async () => {
    const id = poolId("atlas", "tank");
    await simulate("pool", id, "leaf-fails", {}, LATER);
    const pool = getPool(id, LATER);
    expect(pool.state).toBe("DEGRADED");
    const vdevs = flatten(pool.vdevs);
    expect(vdevs.find((vdev) => vdev.name === "raidz2-0")?.state).toBe(
      "DEGRADED",
    );
    expect(vdevs.filter((vdev) => vdev.state === "FAULTED")).toHaveLength(1);
    expect(pool.diary.map((entry) => entry.eventType)).toContain(
      "pool-state-changed",
    );
    expect(liveFaults(id).map((fault) => fault.kind)).toContain(
      "pool-degraded",
    );
  }, 60_000);

  it("puts a spare in use", async () => {
    const id = poolId("styx", "vault");
    await simulate("pool", id, "spare-in-use", {}, LATER);
    const vdevs = flatten(getPool(id, LATER).vdevs);
    const spare = vdevs.find((vdev) => vdev.type === "spare");
    expect(spare?.children.map((child) => child.state).sort()).toEqual([
      "FAULTED",
      "ONLINE",
    ]);
  }, 60_000);

  it("opens pool-data-errors when a scrub finds errors", async () => {
    const id = poolId("atlas", "tank");
    await simulate("pool", id, "scrub-found-errors", { errors: 3 }, LATER);
    const pool = getPool(id, LATER);
    expect(pool.scan).toMatchObject({ state: "FINISHED", errors: 3 });
    expect(pool.errors).toBe(3);
    expect(
      pool.diary.find((entry) => entry.eventType === "scrub-finished"),
    ).toMatchObject({ at: LATER, data: { errors: 3 } });
    expect(liveFaults(id).map((fault) => fault.kind)).toContain(
      "pool-data-errors",
    );
  }, 60_000);

  it("shows a resilver in progress", async () => {
    const id = poolId("styx", "vault");
    await simulate("pool", id, "resilver-in-progress", { progress: 40 }, LATER);
    const { scan, status } = getPool(id, LATER);
    expect(scan).toMatchObject({ function: "RESILVER", state: "SCANNING" });
    expect(status).toMatch(/resilvered/);
  }, 60_000);

  it("fills the pool", async () => {
    const id = poolId("atlas", "tank");
    await simulate("pool", id, "nearly-full", { cap: 92 }, LATER);
    const pool = getPool(id, LATER);
    expect(pool.cap).toBe(92);
    expect(pool.readings.some((reading) => reading.cap === 92)).toBe(true);
  }, 60_000);

  it("adds an error burst to the events", async () => {
    const id = poolId("atlas", "tank");
    await simulate("pool", id, "error-burst", { count: 10 }, LATER);
    const { events } = getPool(id, LATER);
    const burst = events.filter(
      (event) =>
        event.class === "ereport.fs.zfs.checksum" &&
        event.at.getTime() === LATER.getTime(),
    );
    expect(burst).toHaveLength(10);
  }, 60_000);

  it.each([
    ["pool-suspended", (pool: PoolDetail) => pool.state === "SUSPENDED"],
    [
      "leaf-checksum-errors",
      (pool: PoolDetail) =>
        pool.state === "ONLINE" &&
        flatten(pool.vdevs).some((vdev) => vdev.checksumErrors === 12),
    ],
    [
      "permanent-errors",
      (pool: PoolDetail) =>
        pool.errors === 2 && /data\n\tcorruption/.test(pool.status ?? ""),
    ],
    [
      "scrub-overdue",
      (pool: PoolDetail) =>
        pool.scan?.endTime === Math.floor(LATER.getTime() / 1000) - 60 * 86400,
    ],
    ["fragmented", (pool: PoolDetail) => pool.frag === 70],
  ])(
    "%s shows on the pool",
    async (scenario, shows) => {
      const id = poolId("atlas", "tank");
      await simulate("pool", id, scenario, {}, LATER);
      expect(shows(getPool(id, LATER))).toBe(true);
    },
    60_000,
  );
});
