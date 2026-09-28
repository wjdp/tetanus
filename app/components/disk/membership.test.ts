import { describe, expect, it } from "vitest";
import { findMembership } from "./membership";

const leaf = (name: string, diskId: number | null) => ({
  name,
  type: "disk",
  disk: diskId === null ? null : { id: diskId },
  children: [],
});

const pools = [
  {
    id: 1,
    name: "tank",
    vdevs: {
      name: "tank",
      type: "root",
      disk: null,
      children: [
        {
          name: "raidz2-0",
          type: "raidz",
          disk: null,
          children: [leaf("K1", 11), leaf("K2", 12)],
        },
      ],
    },
  },
  { id: 2, name: "empty", vdevs: null },
];

describe("findMembership", () => {
  it("finds the pool, group vdev and leaf for a disk", () => {
    const membership = findMembership(pools, 12);

    expect(membership?.pool.name).toBe("tank");
    expect(membership?.ancestors.map((node) => node.name)).toEqual([
      "raidz2-0",
    ]);
    expect(membership?.leaf.name).toBe("K2");
  });

  it("returns null when the disk is in no pool", () => {
    expect(findMembership(pools, 99)).toBeNull();
  });
});
