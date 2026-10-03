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
  tileStateMark,
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
        group.kicker,
        group.label,
        group.state,
        group.leaves.map(leafLabel),
      ]),
    ).toEqual([
      ["raidz1", null, "raidz1-0", "ONLINE", ["K1", "K2", "K3"]],
      ["disk", null, "stripe", null, ["sdz1"]],
      ["special", "special", "mirror-1", "DEGRADED", ["S1", "S2", "S3"]],
      ["cache", null, "cache", null, ["C1", "C2"]],
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
        leaf("C1", 1, { type: "file", role: "cache" }),
        vdev({ name: "mirror-0", type: "mirror", children: [leaf("M1", 2)] }),
        leaf("L1", 3, { type: "log" }),
        vdev({ name: "mirror-1", type: "special", children: [leaf("S1", 4)] }),
        leaf("P1", 5, { role: "spare" }),
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
      ["mirror-1", true],
      ["log", true],
      ["cache", true],
      ["mirror-3", true],
      ["spares", true],
    ]);
  });

  it("returns nothing for a pool without a tree", () => {
    expect(vdevGroups(null)).toEqual([]);
  });
});

const sold = { kind: "sold", on: "2026-09-01", salePrice: 40 } as const;
const rma = { kind: "rma", on: "2026-10-02" } as const;

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
      disk(13, { state: "dead" }),
      disk(14, { state: "retired", purpose: "system" }),
      disk(15, { state: "removed" }),
    ];

    expect(keysAndIds(railGroups(disks, inPool))).toEqual([
      ["missing", [10]],
      ["removed", [15]],
      ["unseen", [11]],
      ["history", [13, 14]],
    ]);
  });

  it("puts disposed disks in no rail, whatever their state", () => {
    const disks = [
      disk(1, { state: "removed", disposal: sold }),
      disk(2, { state: "missing", disposal: rma }),
      disk(3, { state: "dead", disposal: rma }),
      disk(4, { state: "dead" }),
    ];

    expect(keysAndIds(railGroups(disks, new Set()))).toEqual([
      ["history", [4]],
    ]);
  });

  it("leaves a dead disk plugged into a host to that host", () => {
    const dead = disk(1, { state: "dead", present: true, lastSeenHostId: 2 });
    expect(railGroups([dead], new Set())).toEqual([]);
    expect(keysAndIds(hostDiskGroups([dead], 2, new Set()))).toEqual([
      ["other", [1]],
    ]);
  });
});

describe("hostDiskGroups", () => {
  const live = { present: true, lastSeenHostId: 1 };

  it("splits the host's present disks outside pools into system and other", () => {
    const disks = [
      disk(1, { ...live, state: "retired" }),
      disk(2, { ...live, state: "dead" }),
      disk(3, { ...live, state: "in-use" }),
      disk(4, { ...live, state: "spare", purpose: "other" }),
      disk(5, { ...live, state: "in-use", purpose: "system" }),
      disk(6, { ...live, state: "spare", lastSeenHostId: 2 }),
      disk(7, { state: "spare", lastSeenHostId: 1 }),
      disk(8, { ...live, state: "in-use" }),
    ];

    const groups = hostDiskGroups(disks, 1, new Set([8]));
    expect(keysAndIds(groups)).toEqual([
      ["system", [5]],
      ["other", [1, 2, 3, 4]],
    ]);
    expect(groups.map((group) => [group.label, group.icon])).toEqual([
      ["system", "i-lucide-cpu"],
      ["other", "i-lucide-hard-drive"],
    ]);
  });

  it("leaves out a disposed disk seen on the host again", () => {
    const seenAgain = disk(1, { ...live, state: "in-use", disposal: rma });
    expect(hostDiskGroups([seenAgain], 1, new Set())).toEqual([]);
  });

  it("omits an empty group", () => {
    expect(keysAndIds(hostDiskGroups([disk(1, live)], 1, new Set()))).toEqual([
      ["other", [1]],
    ]);
  });
});

describe("tileStateMark", () => {
  it("marks tiles of disks that are gone or removed, not live ones", () => {
    const mark = (state: TopologyDisk["state"]) =>
      tileStateMark(disk(1, { state }))?.icon ?? null;
    expect(mark("dead")).toBe("i-lucide-skull");
    expect(mark("removed")).toBe("i-lucide-unplug");
    expect(mark("retired")).toBe("i-lucide-archive");
    expect(mark("in-use")).toBeNull();
    expect(mark("spare")).toBeNull();
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

  it("leaves disposed disks out of the counts", () => {
    expect(
      hostDiskSummary([
        disk(1, { media: "hdd", capacityBytes: 18e12 }),
        disk(2, { media: "hdd", capacityBytes: 8e12, disposal: rma }),
      ]),
    ).toEqual({ count: 1, hdd: 1, ssd: 0, rawBytes: 18e12 });
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
