import { describe, expect, it } from "vitest";
import {
  leafLabel,
  linkedDiskIds,
  railColour,
  railGroups,
  type TopologyDisk,
  type TopologyVdev,
  tileColour,
  vdevGroups,
} from "./groupDisks";

let nextId = 1;

function vdev(overrides: Partial<TopologyVdev>): TopologyVdev {
  const id = nextId++;
  return {
    id,
    guid: `guid-${id}`,
    name: `vdev-${id}`,
    type: "disk",
    state: "ONLINE",
    readErrors: 0,
    writeErrors: 0,
    checksumErrors: 0,
    slowIos: 0,
    path: null,
    disk: null,
    children: [],
    ...overrides,
  };
}

function leaf(
  alias: string,
  diskId: number,
  overrides: Partial<TopologyVdev> = {},
) {
  return vdev({
    name: `/dev/disk/by-vdev/${alias}-part1`,
    path: `/dev/disk/by-vdev/${alias}-part1`,
    disk: { id: diskId, alias, state: "in-use", latestStatus: "passed" },
    ...overrides,
  });
}

function disk(id: number, overrides: Partial<TopologyDisk> = {}): TopologyDisk {
  return {
    id,
    alias: `D${id}`,
    model: null,
    serial: null,
    state: "in-use",
    purpose: null,
    latestStatus: "passed",
    ...overrides,
  };
}

const tree = vdev({
  name: "tank",
  type: "root",
  children: [
    vdev({
      name: "raidz1-0",
      type: "raidz1",
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
    leaf("C1", 7, { type: "cache" }),
    leaf("C2", 8, { type: "cache" }),
    vdev({ name: "/dev/sdz1", type: "disk", path: "/dev/sdz1" }),
  ],
});

describe("vdevGroups", () => {
  it("groups top-level vdevs and collects single devices by class", () => {
    const groups = vdevGroups(tree);
    expect(
      groups.map((group) => [
        group.label,
        group.state,
        group.leaves.map(leafLabel),
      ]),
    ).toEqual([
      ["raidz1-0", "ONLINE", ["K1", "K2", "K3"]],
      ["special · mirror-1", "DEGRADED", ["S1", "S2", "S3"]],
      ["cache", null, ["C1", "C2"]],
      ["stripe", null, ["sdz1"]],
    ]);
  });

  it("returns nothing for a pool without a tree", () => {
    expect(vdevGroups(null)).toEqual([]);
  });
});

describe("railGroups", () => {
  it("lists disks outside every pool by state, hiding empty groups", () => {
    const inPool = linkedDiskIds([tree, null]);
    expect([...inPool].sort()).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);

    const disks = [
      disk(1),
      disk(9, { state: "spare" }),
      disk(10, { state: "missing" }),
      disk(11, { state: "unseen" }),
      disk(12, { state: "sold" }),
      disk(13, { state: "spare" }),
    ];

    expect(
      railGroups(disks, inPool).map((group) => [
        group.key,
        group.disks.map((row) => row.id),
      ]),
    ).toEqual([
      ["spare", [9, 13]],
      ["missing", [10]],
      ["unseen", [11]],
      ["sold", [12]],
    ]);
  });
});

describe("railGroups purpose", () => {
  const groups = (disks: TopologyDisk[]) =>
    railGroups(disks, new Set()).map((group) => [
      group.key,
      group.disks.map((row) => row.id),
    ]);

  it("puts system disks under System regardless of state, first", () => {
    expect(
      groups([
        disk(1, { state: "spare" }),
        disk(2, { state: "spare", purpose: "system" }),
        disk(3, { state: "in-use", purpose: "system" }),
      ]),
    ).toEqual([
      ["system", [2, 3]],
      ["spare", [1]],
    ]);
  });

  it("keeps non-system disks by state", () => {
    expect(
      groups([
        disk(1, { purpose: "other" }),
        disk(2, { state: "missing", purpose: "other" }),
      ]),
    ).toEqual([
      ["missing", [2]],
      ["in-use", [1]],
    ]);
  });
});

describe("tileColour", () => {
  it("shows a quiet success mark for a healthy disk", () => {
    expect(tileColour(leaf("K1", 1))).toBe("success");
  });

  it("takes the worst of SMART status and vdev state", () => {
    expect(tileColour(leaf("K1", 1, { state: "DEGRADED" }))).toBe("warning");
    expect(
      tileColour(
        leaf("K1", 1, {
          state: "DEGRADED",
          disk: { id: 1, alias: "K1", state: "in-use", latestStatus: "failed" },
        }),
      ),
    ).toBe("error");
    expect(tileColour(leaf("K1", 1, { state: "FAULTED" }))).toBe("error");
  });

  it("stays neutral for an unlinked leaf with unknown status", () => {
    expect(tileColour(vdev({ name: "/dev/sdz1" }))).toBe("neutral");
  });
});

describe("railColour", () => {
  it("flags missing disks and quietly marks passed spares", () => {
    expect(railColour(disk(1, { state: "missing" }))).toBe("error");
    expect(railColour(disk(1, { state: "spare" }))).toBe("success");
    expect(
      railColour(disk(1, { state: "unseen", latestStatus: "unknown" })),
    ).toBe("neutral");
  });
});
