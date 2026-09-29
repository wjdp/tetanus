import { describe, expect, it } from "vitest";
import {
  diskDot,
  hostDiskGroups,
  hostDiskSummary,
  leafLabel,
  linkedDiskIds,
  railGroups,
  type TopologyDisk,
  tileColour,
  vdevGroups,
} from "./groupDisks";
import {
  diskFixture as disk,
  leafFixture as leaf,
  vdevFixture as vdev,
  vdevDiskFixture as vdevDisk,
} from "./testFixtures";

const tree = vdev({
  name: "tank",
  type: "root",
  children: [
    vdev({
      name: "raidz1-0",
      type: "raidz1",
      sizeBytes: 54e12,
      allocBytes: 11e12,
      children: [leaf("K1", 1), leaf("K2", 2), leaf("K3", 3)],
    }),
    vdev({
      name: "mirror-1",
      type: "special",
      state: "DEGRADED",
      children: [
        leaf("S1", 4),
        vdev({
          name: "replacing-1",
          type: "replacing",
          children: [leaf("S2", 5), leaf("S3", 6)],
        }),
      ],
    }),
    leaf("C1", 7, { type: "cache", sizeBytes: 1e12, allocBytes: 2e11 }),
    leaf("C2", 8, { type: "cache", sizeBytes: 1e12, allocBytes: 3e11 }),
    vdev({ name: "/dev/sdz1", type: "disk", path: "/dev/sdz1" }),
  ],
});

describe("vdevGroups", () => {
  it("groups top-level vdevs and collects single devices by class", () => {
    const groups = vdevGroups(tree);
    expect(
      groups.map((group) => [
        group.type,
        group.label,
        group.state,
        group.leaves.map(leafLabel),
      ]),
    ).toEqual([
      ["raidz1", "raidz1-0", "ONLINE", ["K1", "K2", "K3"]],
      ["disk", "stripe", null, ["sdz1"]],
      ["special", "special · mirror-1", "DEGRADED", ["S1", "S2", "S3"]],
      ["cache", "cache", null, ["C1", "C2"]],
    ]);
  });

  it("takes usage from the vdev and sums it for single-device groups", () => {
    expect(
      vdevGroups(tree).map((group) => [group.sizeBytes, group.allocBytes]),
    ).toEqual([
      [54e12, 11e12],
      [null, null],
      [null, null],
      [2e12, 5e11],
    ]);
  });

  it("puts data vdevs first and class vdevs after them in class order", () => {
    const mixed = vdev({
      name: "tank",
      type: "root",
      children: [
        leaf("C1", 1, { type: "cache" }),
        vdev({ name: "mirror-0", type: "mirror", children: [leaf("M1", 2)] }),
        leaf("L1", 3, { type: "log" }),
        vdev({ name: "mirror-1", type: "special", children: [leaf("S1", 4)] }),
        leaf("P1", 5, { type: "spare" }),
        vdev({ name: "raidz2-2", type: "raidz2", children: [leaf("R1", 6)] }),
        vdev({ name: "/dev/sdz1", type: "disk", path: "/dev/sdz1" }),
        vdev({ name: "mirror-3", type: "dedup", children: [leaf("D1", 7)] }),
      ],
    });

    expect(
      vdevGroups(mixed).map((group) => [group.label, group.isClass]),
    ).toEqual([
      ["mirror-0", false],
      ["raidz2-2", false],
      ["stripe", false],
      ["special · mirror-1", true],
      ["log", true],
      ["cache", true],
      ["dedup · mirror-3", true],
      ["spares", true],
    ]);
  });

  it("returns nothing for a pool without a tree", () => {
    expect(vdevGroups(null)).toEqual([]);
  });
});

const keysAndIds = (groups: { key: string; disks: TopologyDisk[] }[]) =>
  groups.map((group) => [group.key, group.disks.map((row) => row.id)]);

describe("railGroups", () => {
  it("lists absent disks outside every pool, folding the past into History", () => {
    const inPool = linkedDiskIds([tree, null]);
    expect([...inPool].sort()).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);

    const disks = [
      disk(1, { state: "missing" }),
      disk(9, { state: "spare", present: true, lastSeenHostId: 1 }),
      disk(10, { state: "missing" }),
      disk(11, { state: "unseen" }),
      disk(12, { state: "sold" }),
      disk(13, { state: "dead" }),
      disk(14, { state: "retired", purpose: "system" }),
      disk(15, { state: "removed" }),
    ];

    expect(keysAndIds(railGroups(disks, inPool))).toEqual([
      ["missing", [10]],
      ["removed", [15]],
      ["unseen", [11]],
      ["history", [12, 13, 14]],
    ]);
  });

  it("leaves a dead disk plugged into a host to that host", () => {
    const dead = disk(1, { state: "dead", present: true, lastSeenHostId: 2 });
    expect(railGroups([dead], new Set())).toEqual([]);
    expect(keysAndIds(hostDiskGroups([dead], 2, new Set()))).toEqual([
      ["dead", [1]],
    ]);
  });
});

describe("hostDiskGroups", () => {
  it("groups the host's present disks outside pools, system first", () => {
    const live = { present: true, lastSeenHostId: 1 };
    const disks = [
      disk(1, { ...live, state: "sold" }),
      disk(2, { ...live, state: "dead" }),
      disk(3, { ...live, state: "in-use" }),
      disk(4, { ...live, state: "spare" }),
      disk(5, { ...live, state: "in-use", purpose: "system" }),
      disk(6, { ...live, state: "retired" }),
      disk(7, { ...live, state: "spare", lastSeenHostId: 2 }),
      disk(8, { state: "spare", lastSeenHostId: 1 }),
      disk(9, { ...live, state: "in-use" }),
    ];

    const groups = hostDiskGroups(disks, 1, new Set([9]));
    expect(keysAndIds(groups)).toEqual([
      ["system", [5]],
      ["spare", [4]],
      ["in-use", [3]],
      ["dead", [2]],
      ["retired", [6]],
      ["sold", [1]],
    ]);
    expect(groups.map((group) => group.label).slice(0, 4)).toEqual([
      "system",
      "Spare",
      "in use, not in a pool",
      "Dead",
    ]);
  });
});

describe("hostDiskSummary", () => {
  it("counts disks by media and sums known capacities", () => {
    expect(
      hostDiskSummary([
        disk(1, { media: "hdd", capacityBytes: 18e12 }),
        disk(2, { media: "hdd", capacityBytes: 18e12 }),
        disk(3, { media: "ssd", capacityBytes: null }),
        disk(4, { media: null }),
      ]),
    ).toEqual({ count: 4, hdd: 2, ssd: 1, rawBytes: 36e12 });
  });

  it("has no raw capacity when none is known", () => {
    expect(hostDiskSummary([disk(1)]).rawBytes).toBeNull();
  });
});

describe("tileColour", () => {
  it("shows one filled success dot for an ONLINE leaf on a passed disk", () => {
    expect(tileColour(leaf("K1", 1))).toEqual({
      colour: "success",
      shape: "filled",
    });
  });

  it("takes the worst of SMART status and vdev state", () => {
    expect(tileColour(leaf("K1", 1, { state: "DEGRADED" })).colour).toBe(
      "warning",
    );
    expect(
      tileColour(
        leaf("K1", 1, {
          state: "DEGRADED",
          disk: vdevDisk(1, "K1", { latestStatus: "failed" }),
        }),
      ).colour,
    ).toBe("error");
    expect(tileColour(leaf("K1", 1, { state: "FAULTED" })).colour).toBe(
      "error",
    );
  });

  it("is hollow when SMART status is unknown", () => {
    expect(
      tileColour(
        leaf("K1", 1, { disk: vdevDisk(1, "K1", { latestStatus: "unknown" }) }),
      ),
    ).toEqual({ colour: "success", shape: "hollow" });
  });

  it("is a neutral ring for an unlinked leaf", () => {
    expect(tileColour(vdev({ name: "/dev/sdz1" }))).toEqual({
      colour: "neutral",
      shape: "hollow",
    });
  });
});

describe("diskDot", () => {
  it("flags missing disks and quietly marks passed spares", () => {
    expect(diskDot(disk(1, { state: "missing" }))).toEqual({
      colour: "error",
      shape: "filled",
    });
    expect(diskDot(disk(1, { state: "spare" })).colour).toBe("success");
    expect(
      diskDot(disk(1, { state: "unseen", latestStatus: "unknown" })),
    ).toEqual({ colour: "neutral", shape: "hollow" });
  });

  it("keeps a dead disk neutral apart from its SMART reading", () => {
    expect(
      diskDot(disk(1, { state: "dead", latestStatus: "unknown" })).colour,
    ).toBe("neutral");
  });
});
