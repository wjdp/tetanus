import { afterEach, beforeAll, describe, expect, it } from "vitest";
import type { FaultSeverity } from "#shared/faults";
import type { SimulationParams } from "#shared/simulator";
import { runAlertsPass } from "~~/server/services/alerts/dispatch";
import { listFaults } from "~~/server/services/faults";
import { recordIngest } from "~~/server/services/ingest";
import { getPool, listPools, type PoolDetail } from "~~/server/services/zfs";
import { dumpDatabase } from "~~/test/db";
import { readFixture } from "~~/test/fixtures";
import { loadSeededDatabase, SEEDED_AT } from "~~/test/seeded";
import { restore, simulate, subjectScenarios } from "../run";

const NOW = SEEDED_AT;
const LATER = new Date(NOW.getTime() + 10 * 60 * 1000);

let pristine: ReturnType<typeof dumpDatabase>;

function poolId(host: string, name: string) {
  const found = listPools().find(
    (row) => row.host.name === host && row.name === name,
  );
  if (!found) throw new Error(`No pool ${host}/${name}`);
  return found.id;
}

const unresolved = () =>
  listFaults({ state: ["open", "acknowledged", "accepted"] }).faults;

/** Faults the simulation opened, on any subject. */
async function opened(
  id: number,
  scenario: string,
  params: SimulationParams = {},
) {
  const before = new Set(unresolved().map((fault) => fault.id));
  await simulate("pool", id, scenario, params, LATER);
  return unresolved().filter((fault) => !before.has(fault.id));
}

const kindsOf = (faults: Awaited<ReturnType<typeof opened>>) =>
  faults.map((fault) => [fault.kind, fault.subject.type, fault.severity]);

function flatten(node: ReturnType<typeof getPool>["vdevs"]) {
  if (!node) return [];
  const nodes = [node];
  for (const child of node.children) nodes.push(...flatten(child));
  return nodes;
}

beforeAll(async () => {
  loadSeededDatabase();
  // mars's file-backed test pool: a mirror with a log, a cache and a spare.
  recordIngest({
    hostName: "mars",
    source: "zpool-status",
    meta: {},
    body: readFixture("mars/zpool-status-spare-avail.json"),
    receivedAt: NOW,
  });
  await runAlertsPass(LATER);
  pristine = dumpDatabase();
}, 120_000);

afterEach(() => {
  restore();
  expect(dumpDatabase()).toEqual(pristine);
});

describe("pool scenarios", () => {
  it("offers spares and cache failures only to pools that have them", () => {
    const ids = (id: number) =>
      subjectScenarios("pool", id).scenarios.map((scenario) => scenario.id);
    expect(ids(poolId("mars", "tspare"))).toEqual(
      expect.arrayContaining(["spare-in-use", "cache-fails"]),
    );
    expect(ids(poolId("atlas", "tank"))).not.toContain("spare-in-use");
    expect(ids(poolId("atlas", "tank"))).not.toContain("cache-fails");
    expect(ids(poolId("atlas", "tank"))).toEqual(
      expect.arrayContaining([
        "leaf-fails",
        "special-unredundant",
        "nearly-full",
        "error-burst",
      ]),
    );
  });

  it("degrades the pool when a leaf fails, listing the leaf", async () => {
    const id = poolId("atlas", "tank");
    const faults = await opened(id, "leaf-fails");
    const pool = getPool(id, LATER);
    expect(pool.state).toBe("DEGRADED");
    const vdevs = flatten(pool.vdevs);
    expect(vdevs.find((vdev) => vdev.name === "raidz2-0")?.state).toBe(
      "DEGRADED",
    );
    const failed = vdevs.filter((vdev) => vdev.state === "FAULTED");
    expect(failed).toHaveLength(1);
    expect(pool.diary.map((entry) => entry.eventType)).toContain(
      "pool-state-changed",
    );
    expect(kindsOf(faults)).toEqual([["pool-degraded", "pool", "error"]]);
    expect(faults[0]?.data.leaves).toEqual([
      expect.objectContaining({ name: failed[0]?.name, state: "FAULTED" }),
    ]);
  }, 60_000);

  it.each([
    ["UNAVAIL", "error"],
    ["OFFLINE", "warning"],
    ["REMOVED", "warning"],
  ] as [string, FaultSeverity][])(
    "a %s leaf opens pool-degraded as %s",
    async (state, severity) => {
      const faults = await opened(poolId("atlas", "tank"), "leaf-fails", {
        state,
      });
      expect(kindsOf(faults)).toEqual([["pool-degraded", "pool", severity]]);
    },
    60_000,
  );

  it("a pulled disk opens pool-degraded alone, not disk-missing", async () => {
    const faults = await opened(poolId("atlas", "tank"), "disk-pulled");
    expect(kindsOf(faults)).toEqual([["pool-degraded", "pool", "warning"]]);
    expect(faults[0]?.data.leaves).toEqual([
      expect.objectContaining({ state: "REMOVED", diskMissing: true }),
    ]);
  }, 60_000);

  it("puts a spare in use, listing only the failed leaf", async () => {
    const id = poolId("mars", "tspare");
    const faults = await opened(id, "spare-in-use");
    const vdevs = flatten(getPool(id, LATER).vdevs);
    const spare = vdevs.find((vdev) => vdev.type === "spare");
    expect(spare?.children.map((child) => child.state).sort()).toEqual([
      "FAULTED",
      "ONLINE",
    ]);
    expect(
      vdevs.find((vdev) => vdev.name === "/var/tmp/tspare-spare.img"),
    ).toMatchObject({ spareState: "INUSE", state: "ONLINE" });
    expect(kindsOf(faults)).toEqual([["pool-degraded", "pool", "error"]]);
    expect(faults[0]?.data.leaves).toEqual([
      expect.objectContaining({ name: "/var/tmp/tspare-a.img" }),
    ]);
  }, 60_000);

  it("a failed cache device degrades nothing but opens pool-degraded", async () => {
    const id = poolId("mars", "tspare");
    const faults = await opened(id, "cache-fails");
    expect(getPool(id, LATER).state).toBe("ONLINE");
    expect(kindsOf(faults)).toEqual([["pool-degraded", "pool", "error"]]);
    expect(faults[0]?.data.leaves).toEqual([
      expect.objectContaining({ role: "cache", state: "UNAVAIL" }),
    ]);
  }, 60_000);

  it("opens pool-data-errors when a scrub finds errors", async () => {
    const id = poolId("atlas", "tank");
    const faults = await opened(id, "scrub-found-errors", { errors: 3 });
    const pool = getPool(id, LATER);
    expect(pool.scan).toMatchObject({ state: "FINISHED", errors: 3 });
    expect(pool.errors).toBe(3);
    expect(
      pool.diary.find((entry) => entry.eventType === "scrub-finished"),
    ).toMatchObject({ at: LATER, data: { errors: 3 } });
    expect(kindsOf(faults)).toEqual([["pool-data-errors", "pool", "error"]]);
  }, 60_000);

  it("permanent errors list the damaged files and open pool-data-errors only", async () => {
    const id = poolId("atlas", "tank");
    const faults = await opened(id, "permanent-errors");
    const pool = getPool(id, LATER);
    expect(pool).toMatchObject({ errors: 2, msgid: "ZFS-8000-8A" });
    expect(pool.damagedFiles).toHaveLength(2);
    expect(kindsOf(faults)).toEqual([["pool-data-errors", "pool", "error"]]);
  }, 60_000);

  it("a repairing scrub with no errors opens leaf-errors on the leaf only", async () => {
    const id = poolId("atlas", "tank");
    const faults = await opened(id, "scrub-repaired");
    const pool = getPool(id, LATER);
    expect(pool.scan).toMatchObject({
      state: "FINISHED",
      errors: 0,
      processed: 64 * 1024 ** 2,
    });
    expect(kindsOf(faults)).toEqual([["leaf-errors", "pool", "warning"]]);
    expect(faults[0]?.data).toMatchObject({ checksum: 6 });
  }, 60_000);

  it("checksum errors on a raidz open a red group leaf-errors", async () => {
    const faults = await opened(
      poolId("atlas", "tank"),
      "group-checksum-errors",
    );
    expect(kindsOf(faults)).toEqual([["leaf-errors", "pool", "error"]]);
    expect(faults[0]?.data).toMatchObject({ role: "group", checksum: 4 });
  }, 60_000);

  it("a stalled resilver is an error", async () => {
    const faults = await opened(poolId("atlas", "tank"), "scan-stalled", {
      function: "RESILVER",
    });
    expect(kindsOf(faults)).toEqual([["scan-stalled", "pool", "error"]]);
  }, 60_000);

  it.each([
    ["leaf-checksum-errors", "leaf-errors"],
    ["slow-ios", "leaf-slow"],
    ["pool-suspended", "pool-degraded"],
    ["pool-vanishes", "pool-missing"],
    ["special-unredundant", "vdev-unredundant"],
    ["pool-status", "pool-status"],
    ["scrub-paused", "scrub-paused"],
    ["scan-stalled", "scan-stalled"],
    ["scrub-overdue", "scrub-overdue"],
  ])(
    "%s opens %s alone",
    async (scenario, kind) => {
      const faults = await opened(poolId("atlas", "tank"), scenario);
      expect(faults.map((fault) => [fault.kind, fault.subject.type])).toEqual([
        [kind, "pool"],
      ]);
    },
    60_000,
  );

  it.each(["resilver-in-progress", "nearly-full", "fragmented", "error-burst"])(
    "%s opens no fault",
    async (scenario) => {
      expect(await opened(poolId("styx", "vault"), scenario)).toEqual([]);
    },
    60_000,
  );

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
