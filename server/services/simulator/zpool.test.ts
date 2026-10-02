import { describe, expect, it } from "vitest";
import { parse as parseEvents } from "~~/server/ingest/zpool-events";
import { parse as parseList } from "~~/server/ingest/zpool-list";
import {
  parse as parseStatus,
  type ZpoolStatusPool,
} from "~~/server/ingest/zpool-status";
import { readFixture } from "~~/test/fixtures";
import type { StoredPayload } from "./payloads";
import {
  allocationClassMirrors,
  appendEreports,
  cacheLeaves,
  detachToSingle,
  editListPool,
  editStatusPool,
  ereportLeaf,
  failLeaf,
  finishScrub,
  newestEid,
  poolLeaves,
  poolSpares,
  runScan,
  STATUS_MESSAGES,
  type StatusPool,
  setDataErrors,
  setGroupErrors,
  setLeafErrors,
  setListCapacity,
  setListFragmentation,
  showMessage,
  startResilver,
  statusPoolIn,
  suspendPool,
  UNCOVERED_STATUS_MESSAGES,
  useSpare,
  withoutStatusPool,
} from "./zpool";

const NOW = new Date("2026-10-02T12:00:00Z");

const payloadOf = (
  source: StoredPayload["source"],
  body: string,
): StoredPayload => ({
  source,
  device: "",
  meta: {},
  producer: null,
  body,
});

const statusFixture = () =>
  payloadOf("zpool-status", readFixture("mars/zpool-status-stored-paths.json"));

function parsedPool(stored: StoredPayload, name: string): ZpoolStatusPool {
  const found = parseStatus(stored.body, {}).data.pools.find(
    (pool) => pool.name === name,
  );
  if (!found) throw new Error(`No ${name}`);
  return found;
}

const vdevNamed = (pool: ZpoolStatusPool, name: string) =>
  pool.vdevs.find((vdev) => vdev.name === name);

function firstLeaf(stored: StoredPayload, name: string) {
  return poolLeaves(statusPoolIn(stored.body, name))[0]?.name ?? "";
}

describe("zpool status edits", () => {
  it("round-trips untouched pools and keeps guids bare", () => {
    const original = statusFixture();
    const edited = editStatusPool(original, "tank", () => {});
    expect(edited.body).toMatch(/"pool_guid":4620770592528249368/);
    expect(parseStatus(edited.body, {}).data).toEqual(
      parseStatus(original.body, {}).data,
    );
  });

  it("lists data leaves before special ones", () => {
    const leaves = poolLeaves(statusPoolIn(statusFixture().body, "tank"));
    expect(leaves[0]?.name).toBe("/dev/disk/by-vdev/K1-part1");
    expect(leaves.at(-1)?.class).toBe("special");
  });

  it("degrades the vdev and pool when one leaf fails", () => {
    const stored = statusFixture();
    const leaf = firstLeaf(stored, "tank");
    const edited = editStatusPool(stored, "tank", (pool) =>
      failLeaf(pool, leaf, "FAULTED"),
    );
    const tank = parsedPool(edited, "tank");
    expect(vdevNamed(tank, leaf)?.state).toBe("FAULTED");
    expect(vdevNamed(tank, "raidz1-0")?.state).toBe("DEGRADED");
    expect(vdevNamed(tank, "raidz1-1")?.state).toBe("ONLINE");
    expect(tank.state).toBe("DEGRADED");
    expect(tank.status).toBe(STATUS_MESSAGES.faultedDev.status);
    expect(parsedPool(edited, "zeta").state).toBe("ONLINE");
  });

  it("uses the message for each failure state", () => {
    const stored = statusFixture();
    const leaf = firstLeaf(stored, "tank");
    const statusFor = (state: "UNAVAIL" | "REMOVED" | "OFFLINE") =>
      parsedPool(
        editStatusPool(stored, "tank", (pool) => failLeaf(pool, leaf, state)),
        "tank",
      ).status;
    expect(statusFor("UNAVAIL")).toBe(STATUS_MESSAGES.missingDev.status);
    expect(statusFor("REMOVED")).toBe(STATUS_MESSAGES.removedDev.status);
    expect(statusFor("OFFLINE")).toBe(STATUS_MESSAGES.offlineDev.status);
  });

  it("makes the pool unavailable past redundancy", () => {
    const stored = statusFixture();
    const [first, second] = poolLeaves(statusPoolIn(stored.body, "zeta"));
    const edited = editStatusPool(stored, "zeta", (pool) => {
      failLeaf(pool, first?.name ?? "", "FAULTED");
      failLeaf(pool, second?.name ?? "", "UNAVAIL");
    });
    const zeta = parsedPool(edited, "zeta");
    expect(vdevNamed(zeta, "mirror-1")?.state).toBe("UNAVAIL");
    expect(zeta.state).toBe("UNAVAIL");
    expect(zeta.status).toBe(STATUS_MESSAGES.faultedDevNoReplicas.status);
  });

  it("suspends the pool after losing a vdev", () => {
    const edited = editStatusPool(statusFixture(), "tank", suspendPool);
    const tank = parsedPool(edited, "tank");
    expect(tank.state).toBe("SUSPENDED");
    expect(tank.status).toBe(STATUS_MESSAGES.ioFailure.status);
    expect(vdevNamed(tank, "raidz1-0")?.state).toBe("UNAVAIL");
    const lost = tank.vdevs.filter((vdev) => vdev.state === "UNAVAIL");
    expect(lost.filter((vdev) => vdev.type === "disk")).toHaveLength(2);
  });

  it("keeps the pool ONLINE with checksum errors on a leaf", () => {
    const stored = statusFixture();
    const leaf = firstLeaf(stored, "tank");
    const edited = editStatusPool(stored, "tank", (pool) =>
      setLeafErrors(pool, leaf, { read: 0, write: 0, checksum: 12 }),
    );
    const tank = parsedPool(edited, "tank");
    expect(tank.state).toBe("ONLINE");
    expect(vdevNamed(tank, leaf)?.checksumErrors).toBe(12);
    expect(tank.status).toBe(STATUS_MESSAGES.failingDev.status);
  });

  it("records data errors and a finished scrub", () => {
    const edited = editStatusPool(statusFixture(), "tank", (pool) => {
      finishScrub(pool, {
        endedAt: NOW,
        errors: 3,
        repairedBytes: 64 * 1024 ** 2,
      });
      setDataErrors(pool, 3);
    });
    const tank = parsedPool(edited, "tank");
    expect(tank.errors).toBe(3);
    expect(tank.status).toBe(STATUS_MESSAGES.corruptData.status);
    expect(tank.scan).toMatchObject({
      function: "SCRUB",
      state: "FINISHED",
      endTime: NOW.getTime() / 1000,
      errors: 3,
      processed: 64 * 1024 ** 2,
    });
    expect(tank.scan?.startTime).toBe(
      NOW.getTime() / 1000 - (1789325257 - 1789255441),
    );
  });

  it("starts a resilver and brings a failed leaf back", () => {
    const stored = statusFixture();
    const leaf = firstLeaf(stored, "tank");
    const failed = editStatusPool(stored, "tank", (pool) =>
      failLeaf(pool, leaf, "UNAVAIL"),
    );
    const edited = editStatusPool(failed, "tank", (pool) =>
      startResilver(pool, leaf, 40, NOW),
    );
    const tank = parsedPool(edited, "tank");
    expect(tank.state).toBe("ONLINE");
    expect(tank.status).toBe(STATUS_MESSAGES.resilvering.status);
    expect(tank.scan).toMatchObject({
      function: "RESILVER",
      state: "SCANNING",
    });
    const scan = tank.scan as NonNullable<ZpoolStatusPool["scan"]>;
    expect(Math.floor((scan.examined / scan.toExamine) * 100)).toBe(40);
    expect(scan.startTime).toBeLessThan(NOW.getTime() / 1000);
  });

  it("clears its own messages once nothing is wrong", () => {
    const stored = statusFixture();
    const leaf = firstLeaf(stored, "tank");
    const failed = editStatusPool(stored, "tank", (pool) =>
      failLeaf(pool, leaf, "OFFLINE"),
    );
    const healed = editStatusPool(failed, "tank", (pool: StatusPool) => {
      const vdev = pool.vdevs[leaf];
      if (vdev) vdev.state = "ONLINE";
    });
    const tank = parsedPool(healed, "tank");
    expect(tank.state).toBe("ONLINE");
    expect(tank.status).toBeUndefined();
  });
});

describe("spares, logs and cache", () => {
  const avail = payloadOf(
    "zpool-status",
    readFixture("mars/zpool-status-spare-avail.json"),
  );
  const leaf = "/var/tmp/tspare-a.img";
  const spare = "/var/tmp/tspare-spare.img";

  it("offers the AVAIL spare, and keeps it and the cache out of the pool state", () => {
    const tspare = statusPoolIn(avail.body, "tspare");
    expect(poolSpares(tspare).map((vdev) => vdev.name)).toEqual([spare]);
    expect(poolLeaves(tspare).map((vdev) => vdev.name)).not.toContain(spare);
    expect(cacheLeaves(tspare).map((vdev) => vdev.name)).toEqual([
      "/var/tmp/tspare-cache.img",
    ]);
    const settled = editStatusPool(avail, "tspare", () => {});
    expect(parseStatus(settled.body, {}).data).toEqual(
      parseStatus(avail.body, {}).data,
    );
  });

  it("puts a spare in use as real zpool status shows it", () => {
    const edited = editStatusPool(avail, "tspare", (pool) =>
      useSpare(pool, leaf, spare, "OFFLINE"),
    );
    const inuse = payloadOf(
      "zpool-status",
      readFixture("mars/zpool-status-spare-inuse.json"),
    );
    const shape = (stored: StoredPayload) =>
      parsedPool(stored, "tspare").vdevs.map((vdev) => ({
        name: vdev.name,
        type: vdev.type,
        role: vdev.role,
        state: vdev.state,
        spareState: vdev.spareState,
        parent: parsedPool(stored, "tspare").vdevs.find(
          (other) => other.guid === vdev.parentGuid,
        )?.name,
      }));
    const byName = (a: { name: string }, b: { name: string }) =>
      a.name.localeCompare(b.name);
    expect(shape(edited).sort(byName)).toEqual(shape(inuse).sort(byName));
    const raw = statusPoolIn(edited.body, "tspare");
    expect(raw.vdevs[spare]).toMatchObject({ state: "INUSE", aux: "SPARED" });
    expect(raw.state).toBe("DEGRADED");
  });

  it("keeps the pool ONLINE when the cache device fails", () => {
    const edited = editStatusPool(avail, "tspare", (pool) =>
      failLeaf(pool, "/var/tmp/tspare-cache.img", "UNAVAIL"),
    );
    const tspare = parsedPool(edited, "tspare");
    expect(tspare.state).toBe("ONLINE");
    expect(vdevNamed(tspare, "/var/tmp/tspare-cache.img")).toMatchObject({
      role: "cache",
      state: "UNAVAIL",
    });
  });

  it("only degrades the pool when the log device fails", () => {
    const edited = editStatusPool(avail, "tspare", (pool) =>
      failLeaf(pool, "/var/tmp/tspare-log.img", "FAULTED"),
    );
    expect(parsedPool(edited, "tspare").state).toBe("DEGRADED");
  });
});

describe("messages and errors", () => {
  it("lists damaged files and the message id with permanent errors", () => {
    const edited = editStatusPool(statusFixture(), "tank", (pool) =>
      setDataErrors(pool, 2),
    );
    const tank = parsedPool(edited, "tank");
    expect(tank).toMatchObject({
      errors: 2,
      msgid: "ZFS-8000-8A",
      moreinfo: "https://openzfs.github.io/openzfs-docs/msg/ZFS-8000-8A",
    });
    expect(tank.damagedFiles).toHaveLength(2);
    const cleared = editStatusPool(edited, "tank", (pool) =>
      setDataErrors(pool, 0),
    );
    expect(parsedPool(cleared, "tank")).toMatchObject({
      errors: 0,
      msgid: undefined,
      status: undefined,
    });
  });

  it("keeps an unprivileged errlist", () => {
    const stored = payloadOf(
      "zpool-status",
      readFixture("mars/zpool-status-errlist-unprivileged.json"),
    );
    const edited = editStatusPool(stored, "tfault", (pool) =>
      setDataErrors(pool, 3),
    );
    expect(parsedPool(edited, "tfault")).toMatchObject({
      errors: 3,
      damagedFilesError: "Permission denied",
    });
  });

  it("keeps a message no state explains", () => {
    const edited = editStatusPool(statusFixture(), "tank", (pool) =>
      showMessage(pool, UNCOVERED_STATUS_MESSAGES["ZFS-8000-EY"] as never),
    );
    expect(parsedPool(edited, "tank")).toMatchObject({
      state: "ONLINE",
      msgid: "ZFS-8000-EY",
    });
  });

  it("counts errors on a group", () => {
    const edited = editStatusPool(statusFixture(), "tank", (pool) =>
      setGroupErrors(pool, "raidz1-1", { read: 0, write: 0, checksum: 4 }),
    );
    expect(vdevNamed(parsedPool(edited, "tank"), "raidz1-1")).toMatchObject({
      checksumErrors: 4,
      state: "ONLINE",
    });
  });
});

describe("scans and layout", () => {
  it("pauses a scrub at the given time", () => {
    const pausedAt = new Date(NOW.getTime() - 30 * 3600_000);
    const edited = editStatusPool(statusFixture(), "tank", (pool) =>
      runScan(pool, {
        function: "SCRUB",
        percent: 40,
        movedAt: pausedAt,
        paused: true,
      }),
    );
    const scan = parsedPool(edited, "tank").scan;
    expect(scan).toMatchObject({
      function: "SCRUB",
      state: "SCANNING",
      pausedAt: pausedAt.getTime() / 1000,
    });
    expect(scan?.startTime).toBeLessThan(pausedAt.getTime() / 1000);
  });

  it("detaches a special mirror down to one top-level device", () => {
    const stored = statusFixture();
    const [mirror] = allocationClassMirrors(statusPoolIn(stored.body, "tank"));
    expect(mirror?.name).toBe("mirror-4");
    const edited = editStatusPool(stored, "tank", (pool) =>
      detachToSingle(pool, "mirror-4"),
    );
    const tank = parsedPool(edited, "tank");
    expect(vdevNamed(tank, "mirror-4")).toBeUndefined();
    expect(vdevNamed(tank, "/dev/disk/by-vdev/M2-part1")).toBeUndefined();
    const root = vdevNamed(tank, "tank");
    expect(vdevNamed(tank, "/dev/disk/by-vdev/M1-part1")).toMatchObject({
      role: "special",
      parentGuid: root?.guid,
    });
    expect(tank.state).toBe("ONLINE");
  });

  it("drops a pool from the payload", () => {
    const edited = withoutStatusPool(statusFixture(), "zeta");
    expect(
      parseStatus(edited.body, {}).data.pools.map((pool) => pool.name),
    ).toEqual(["tank"]);
  });
});

describe("zpool list edits", () => {
  const stored = payloadOf("zpool-list", readFixture("mars/zpool-list.json"));

  it("sets capacity consistently on the pool and its data vdevs", () => {
    const edited = editListPool(stored, "tank", (pool) =>
      setListCapacity(pool, 92),
    );
    const tank = parseList(edited.body, {}).data.pools.find(
      (pool) => pool.name === "tank",
    );
    const size = tank?.properties.size?.value as number;
    expect(tank?.properties.capacity?.value).toBe(92);
    expect(tank?.properties.allocated?.value).toBe(Math.round(size * 0.92));
    expect(tank?.properties.free?.value).toBe(size - Math.round(size * 0.92));
    expect(edited.body).toMatch(/"pool_guid":4620770592528249368/);
  });

  it("sets fragmentation", () => {
    const edited = editListPool(stored, "zeta", (pool) =>
      setListFragmentation(pool, 70),
    );
    const pools = parseList(edited.body, {}).data.pools;
    expect(
      pools.find((pool) => pool.name === "zeta")?.properties.fragmentation
        ?.value,
    ).toBe(70);
    expect(
      pools.find((pool) => pool.name === "tank")?.properties.fragmentation
        ?.value,
    ).toBe(9);
  });
});

describe("zpool events edits", () => {
  const body = readFixture("mars/zpool-events.txt");
  const status = statusPoolIn(
    readFixture("mars/zpool-status-stored-paths.json"),
    "tank",
  );
  const leafName = poolLeaves(status)[0]?.name ?? "";

  it("appends ereports after the newest eid, at the simulation time", () => {
    const before = parseEvents(body, {}).data.events;
    const after = parseEvents(
      appendEreports(body, {
        eventClass: "ereport.fs.zfs.checksum",
        pool: { name: "tank", guid: status.pool_guid ?? "" },
        leaf: ereportLeaf(status, leafName),
        count: 10,
        at: NOW,
      }),
      {},
    ).data.events;
    expect(after.slice(0, before.length)).toEqual(before);
    const added = after.slice(before.length);
    expect(added).toHaveLength(10);
    expect(added.map((event) => event.eid)).toEqual(
      Array.from({ length: 10 }, (_, index) => newestEid(body) + 1 + index),
    );
    expect(added[0]).toMatchObject({
      class: "ereport.fs.zfs.checksum",
      at: NOW.toISOString(),
      pool: "tank",
      poolGuid: status.pool_guid,
      vdevGuid: status.vdevs[leafName]?.guid,
    });
    expect(added[0]?.fields.parent_type).toBe("raidz");
  });

  it("numbers on from a higher stored eid and omits the vdev for data errors", () => {
    const added = parseEvents(
      appendEreports(body, {
        eventClass: "ereport.fs.zfs.data",
        pool: { name: "tank", guid: status.pool_guid ?? "" },
        leaf: ereportLeaf(status, leafName),
        count: 1,
        at: NOW,
        afterEid: 1_000_000,
      }),
      {},
    ).data.events.at(-1);
    expect(added).toMatchObject({ eid: 1_000_001, vdevGuid: null });
  });
});
