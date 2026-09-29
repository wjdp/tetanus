import { describe, expect, it } from "vitest";
import { PARSERS } from "~~/server/ingest/registry";
import type { ZfsSnapshotsResult } from "~~/server/ingest/zfs-snapshots";
import type { ZpoolEventsResult } from "~~/server/ingest/zpool-events";
import type { ZpoolHistoryResult } from "~~/server/ingest/zpool-history";
import type {
  ZpoolStatusPool,
  ZpoolStatusResult,
} from "~~/server/ingest/zpool-status";
import { recordIngest } from "~~/server/services/ingest";
import { listDatasets, listPools, type VdevNode } from "~~/server/services/zfs";
import { addMs, DAY_MS, HOUR_MS } from "./timeline";
import type { HostModel, HostName } from "./types";
import { createWorld } from "./world";
import { renderZfs } from "./zfs";
import { leafGuid } from "./zfsCommon";
import { lastReplication } from "./zfsDatasets";
import { HISTORY_TAIL_LINES } from "./zpoolHistory";

const world = createWorld();
const { timeline, fleet, stories } = world;
const { anchor } = timeline;
const host = (name: HostName) =>
  fleet.hosts.find((candidate) => candidate.name === name) as HostModel;

const payloadOf = (name: HostName, source: string, t = anchor) => {
  const found = renderZfs(world, host(name), t).find(
    (payload) => payload.source === source,
  );
  if (!found) throw new Error(`No ${source} for ${name} at ${t.toISOString()}`);
  return found;
};

const parsed = <T>(name: HostName, source: string, t = anchor) => {
  const { body, meta } = payloadOf(name, source, t);
  return PARSERS[source as keyof typeof PARSERS](body, meta).data as T;
};

const statusPool = (name: HostName, pool: string, t = anchor) => {
  const found = parsed<ZpoolStatusResult>(name, "zpool-status", t).pools.find(
    (candidate) => candidate.name === pool,
  );
  if (!found) throw new Error(`No pool ${pool}`);
  return found;
};

const leafNamed = (pool: ZpoolStatusPool, alias: string) =>
  pool.vdevs.find(
    (vdev) => vdev.type === "disk" && vdev.name.includes(`/${alias}-part`),
  );

const resilverAt = addMs(timeline.v2ReplaceAt, 5 * HOUR_MS);

const INSTANTS = {
  anchor,
  "anchor − 40 d": addMs(anchor, -40 * DAY_MS),
  "anchor − 33 d (V2 faulted)": addMs(anchor, -33 * DAY_MS),
  "V2 → V6 resilver": resilverAt,
  "anchor − 400 d": addMs(anchor, -400 * DAY_MS),
};

const ZFS_SOURCES = [
  "zpool-status",
  "zpool-list",
  "zfs-list",
  "zfs-snapshots",
  "zpool-history",
  "zpool-events",
];

describe("renderZfs", () => {
  describe.each(Object.entries(INSTANTS))("at %s", (_label, t) => {
    it.each(fleet.hosts.map((model) => [model.name, model] as const))(
      "renders every ZFS source for %s and each parses",
      (_name, model) => {
        const payloads = renderZfs(world, model, t);
        expect(payloads.map((payload) => payload.source)).toEqual(ZFS_SOURCES);
        for (const { source, body, meta } of payloads) {
          expect(meta).toEqual({});
          expect(() => PARSERS[source](body, meta)).not.toThrow();
        }
      },
    );
  });

  it("is deterministic", () => {
    for (const model of fleet.hosts) {
      expect(renderZfs(world, model, anchor)).toEqual(
        renderZfs(world, model, anchor),
      );
    }
  });

  it("renders nothing for a host before its first pool", () => {
    expect(renderZfs(world, host("styx"), host("styx").installedAt)).toEqual(
      [],
    );
  });

  it("keeps the last 500 lines of zpool history", () => {
    for (const model of fleet.hosts) {
      const lines = payloadOf(model.name, "zpool-history").body.split("\n");
      expect(lines.length - 1).toBeLessThanOrEqual(HISTORY_TAIL_LINES);
    }
  });
});

describe("stories at the anchor", () => {
  it("has tank ~40 % through a scrub", () => {
    const tank = statusPool("atlas", "tank");
    expect(tank.scan).toMatchObject({ function: "SCRUB", state: "SCANNING" });
    const scan = tank.scan as NonNullable<ZpoolStatusPool["scan"]>;
    expect(scan.examined / scan.toExamine).toBeCloseTo(0.4, 2);
  });

  it("has vault's last scrub finished with no errors", () => {
    const vault = statusPool("styx", "vault");
    expect(vault.state).toBe("ONLINE");
    expect(vault.scan).toMatchObject({
      function: "SCRUB",
      state: "FINISHED",
      errors: 0,
      endTime: Math.floor(timeline.vaultScrubEnd.getTime() / 1000),
    });
  });

  it("has V6 in vault and V5 listed as an UNAVAIL spare", () => {
    const vault = statusPool("styx", "vault");
    expect(leafNamed(vault, "V6")).toMatchObject({ state: "ONLINE" });
    expect(leafNamed(vault, "V2")).toBeUndefined();
    const raw = JSON.parse(payloadOf("styx", "zpool-status").body);
    expect(raw.pools.vault.spares).toEqual({
      "/dev/disk/by-vdev/V5-part1": expect.objectContaining({
        class: "spare",
        state: "UNAVAIL",
      }),
    });
  });

  it("has checksum errors on A7 with matching ereports", () => {
    const tank = statusPool("atlas", "tank");
    const a7 = leafNamed(tank, "A7");
    expect(a7?.checksumErrors).toBeGreaterThan(0);
    expect(tank.status).toMatch(/unrecoverable error/);
    const ereports = parsed<ZpoolEventsResult>(
      "atlas",
      "zpool-events",
    ).events.filter((event) => event.class === "ereport.fs.zfs.checksum");
    expect(ereports.length).toBe(a7?.checksumErrors);
    expect(new Set(ereports.map((event) => event.vdevGuid))).toEqual(
      new Set([a7?.guid]),
    );
    expect(a7?.guid).toBe(
      leafGuid(stories.pool("atlas", "tank"), stories.disk("A7")),
    );
  });

  it("numbers events from 1 since the last boot, in order", () => {
    for (const model of fleet.hosts) {
      const { events } = parsed<ZpoolEventsResult>(model.name, "zpool-events");
      const eids = events.flatMap((event) =>
        event.eid === null ? [] : [event.eid],
      );
      expect(eids).toEqual(eids.map((_, index) => index + 1));
      const times = events.map((event) => Date.parse(event.at));
      expect(times).toEqual([...times].sort((a, b) => a - b));
      expect(times[0]).toBeGreaterThan(
        stories.lastBoot(model.name, anchor).getTime(),
      );
    }
  });

  it("keeps eids stable as more events arrive", () => {
    const eidsAt = (t: Date) =>
      new Map(
        parsed<ZpoolEventsResult>("styx", "zpool-events", t).events.map(
          (event) => [`${event.at}|${event.class}`, event.eid],
        ),
      );
    const earlier = eidsAt(resilverAt);
    const later = eidsAt(anchor);
    for (const [key, eid] of earlier) expect(later.get(key)).toBe(eid);
  });
});

describe("V2's failure and replacement", () => {
  it("shows vault DEGRADED with V2 FAULTED before the replace", () => {
    const vault = statusPool("styx", "vault", addMs(anchor, -33 * DAY_MS));
    expect(vault.state).toBe("DEGRADED");
    expect(leafNamed(vault, "V2")).toMatchObject({
      state: "FAULTED",
      checksumErrors: 204,
    });
    expect(vault.status).toMatch(/faulted/);
  });

  it("shows a replacing vdev with V2 and V6 while resilvering", () => {
    const vault = statusPool("styx", "vault", resilverAt);
    expect(vault.scan).toMatchObject({
      function: "RESILVER",
      state: "SCANNING",
    });
    const replacing = vault.vdevs.find((vdev) => vdev.type === "replacing");
    expect(replacing).toMatchObject({ name: "replacing-1", state: "DEGRADED" });
    const children = vault.vdevs.filter(
      (vdev) => vdev.parentGuid === replacing?.guid,
    );
    expect(children.map((vdev) => [vdev.path, vdev.state])).toEqual([
      ["/dev/disk/by-vdev/V2-part1", "FAULTED"],
      ["/dev/disk/by-vdev/V6-part1", "ONLINE"],
    ]);
    const raidz = vault.vdevs.find((vdev) => vdev.type === "raidz1");
    expect(replacing?.parentGuid).toBe(raidz?.guid);
  });

  it("records the replace in zpool history", () => {
    const { entries } = parsed<ZpoolHistoryResult>(
      "styx",
      "zpool-history",
      resilverAt,
    );
    expect(entries.map((entry) => entry.text)).toContain(
      "zpool replace vault V2 V6",
    );
  });
});

describe("leaf paths", () => {
  it("uses by-vdev aliases on vdev_id.conf hosts and by-id partitions for boot pools", () => {
    const tankLeaf = leafNamed(statusPool("atlas", "tank"), "A1");
    expect(tankLeaf?.path).toBe("/dev/disk/by-vdev/A1-part1");
    expect(tankLeaf?.devid).toMatch(/^scsi-35000c500[0-9a-f]{8}-part1$/);
    const pipLeaves = statusPool("pip", "rpool").vdevs.filter(
      (vdev) => vdev.type === "disk",
    );
    expect(pipLeaves.map((vdev) => vdev.path)).toEqual([
      expect.stringMatching(
        /^\/dev\/disk\/by-id\/nvme-CT1000P3PSSD8_.*-part2$/,
      ),
      expect.stringMatching(/^\/dev\/disk\/by-id\/nvme-WDS100T1R0C-.*-part2$/),
    ]);
  });
});

describe("snapshots", () => {
  const snapshotsOf = (name: HostName, t = anchor) =>
    parsed<ZfsSnapshotsResult>(name, "zfs-snapshots", t).snapshots;

  it("totals about 1500 across the fleet", () => {
    const total = fleet.hosts.reduce(
      (sum, model) => sum + snapshotsOf(model.name).length,
      0,
    );
    expect(total).toBeGreaterThan(1400);
    expect(total).toBeLessThan(1600);
  });

  it("uses sanoid and zfs-auto-snapshot names and sorts by creation", () => {
    const atlas = snapshotsOf("atlas");
    expect(atlas.map((snapshot) => snapshot.name)).toContain(
      "tank/photos@autosnap_2026-09-29_00:00:00_daily",
    );
    expect(snapshotsOf("pip").map((snapshot) => snapshot.name)).toContain(
      "rpool/home@zfs-auto-snap_hourly-2026-09-29-0317",
    );
    const creations = atlas.map((snapshot) => snapshot.creation);
    expect(creations).toEqual([...creations].sort((a, b) => a - b));
  });

  it("shares GUIDs between tank datasets and their vault replicas", () => {
    const sources = new Map(
      snapshotsOf("atlas").map((snapshot) => [snapshot.name, snapshot.guid]),
    );
    const replicas = snapshotsOf("styx").filter((snapshot) =>
      snapshot.dataset.startsWith("vault/replica/"),
    );
    const shared = replicas.filter((snapshot) =>
      sources.has(snapshot.name.replace("vault/replica/", "")),
    );
    expect(shared.length).toBeGreaterThan(50);
    for (const snapshot of shared) {
      expect(snapshot.guid).toBe(
        sources.get(snapshot.name.replace("vault/replica/", "")),
      );
    }
    const newest = Math.max(...replicas.map((snapshot) => snapshot.creation));
    expect(newest * 1000).toBeLessThanOrEqual(
      lastReplication(anchor).getTime(),
    );
  });

  it("keeps older dailies on the replica than on the source", () => {
    const dailies = (name: HostName, dataset: string) =>
      snapshotsOf(name).filter(
        (snapshot) =>
          snapshot.dataset === dataset && snapshot.snapshot.endsWith("_daily"),
      ).length;
    expect(dailies("atlas", "tank/media/music")).toBe(14);
    expect(dailies("styx", "vault/replica/tank/media/music")).toBe(120);
  });
});

describe("ingest pipeline", () => {
  const ingest = (name: HostName, t: Date) => {
    for (const { source, meta, body } of renderZfs(world, host(name), t)) {
      const outcome = recordIngest({
        hostName: name,
        source,
        meta,
        body,
        receivedAt: t,
      });
      expect(outcome, `${name} ${source}`).toMatchObject({ ok: true });
    }
  };

  const leavesOf = (node: VdevNode | null): VdevNode[] =>
    node === null
      ? []
      : node.children.length === 0
        ? [node]
        : node.children.flatMap(leavesOf);

  it("builds pools, vdevs, datasets and snapshots through the services", () => {
    ingest("styx", addMs(anchor, -33 * DAY_MS));
    ingest("styx", resilverAt);
    for (const model of fleet.hosts) ingest(model.name, anchor);

    const pools = listPools();
    expect(pools.map((pool) => `${pool.host.name}/${pool.name}`)).toEqual([
      "atlas/rpool",
      "atlas/scratch",
      "atlas/tank",
      "bench/burnin",
      "pip/rpool",
      "styx/rpool",
      "styx/vault",
    ]);
    const byName = (key: string) =>
      pools.find((pool) => `${pool.host.name}/${pool.name}` === key);

    const tank = byName("atlas/tank");
    expect(tank?.vdevs?.children.map((vdev) => [vdev.name, vdev.type])).toEqual(
      [
        ["mirror-2", "special"],
        ["raidz2-0", "raidz2"],
        ["raidz2-1", "raidz2"],
      ],
    );
    expect(leavesOf(tank?.vdevs ?? null)).toHaveLength(14);
    expect(tank).toMatchObject({ state: "ONLINE", health: "ONLINE" });

    const vault = byName("styx/vault");
    expect(vault).toMatchObject({ state: "ONLINE" });
    expect(leavesOf(vault?.vdevs ?? null).map((vdev) => vdev.path)).toEqual([
      "/dev/disk/by-vdev/V1-part1",
      "/dev/disk/by-vdev/V3-part1",
      "/dev/disk/by-vdev/V4-part1",
      "/dev/disk/by-vdev/V6-part1",
    ]);

    for (const [key, datasets] of [
      ["atlas/tank", 17],
      ["styx/vault", 11],
      ["pip/rpool", 5],
    ] as const) {
      const pool = byName(key);
      expect(pool?.datasetCount).toBe(datasets);
      expect(listDatasets(pool?.id ?? 0)).toHaveLength(datasets);
    }
    const snapshots = pools.reduce((sum, pool) => sum + pool.snapshotCount, 0);
    expect(snapshots).toBeGreaterThan(1400);
    expect(snapshots).toBeLessThan(1600);
  });
});
