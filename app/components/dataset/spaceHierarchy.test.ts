import { describe, expect, it } from "vitest";
import {
  buildSpaceHierarchy,
  type SpaceBox,
  type SpaceDataset,
  type SpaceNode,
  spaceSplit,
} from "./spaceHierarchy";

const dataset = (
  id: number,
  name: string,
  parentId: number | null,
  extra: Partial<SpaceDataset> = {},
): SpaceDataset => ({
  id,
  name,
  parentId,
  present: true,
  used: 100,
  available: 1000,
  usedByDataset: 60,
  usedBySnapshots: 40,
  usedByChildren: 0,
  growth: null,
  ...extra,
});

const summary = (node: SpaceNode): unknown =>
  node.kind === "dataset"
    ? { [node.dataset.name]: node.children.map(summary) }
    : [node.kind, node.bytes];

describe("spaceSplit", () => {
  it("takes the reserved space as what the other usedby properties leave", () => {
    const volume = dataset(1, "tank/vm", null, {
      used: 500,
      usedByDataset: 100,
      usedBySnapshots: 50,
      usedByChildren: 0,
    });
    expect(spaceSplit(volume, 0)).toEqual({
      data: 100,
      snapshots: 50,
      children: 0,
      reserved: 350,
    });
  });

  it("derives the split from the children when usedby properties are missing", () => {
    const old = dataset(1, "tank", null, {
      used: 300,
      usedByDataset: null,
      usedBySnapshots: null,
      usedByChildren: null,
    });
    expect(spaceSplit(old, 200)).toEqual({
      data: 100,
      snapshots: 0,
      children: 200,
      reserved: 0,
    });
  });
});

describe("buildSpaceHierarchy", () => {
  const datasets = [
    dataset(1, "tank", null, {
      used: 300,
      usedByDataset: 10,
      usedBySnapshots: 0,
      usedByChildren: 290,
      available: 700,
    }),
    dataset(2, "tank/media", 1, { used: 190, usedByChildren: 90 }),
    dataset(3, "tank/media/films", 2, {
      used: 90,
      usedByDataset: 90,
      usedBySnapshots: 0,
    }),
    dataset(4, "tank/home", 1),
    dataset(5, "tank/old", 1, { present: false }),
  ];

  it("nests datasets with their own data, snapshot and reserved tiles", () => {
    expect(summary(buildSpaceHierarchy(datasets) as SpaceBox)).toEqual({
      tank: [
        ["data", 10],
        {
          "tank/media": [
            ["data", 60],
            ["snapshots", 40],
            { "tank/media/films": [["data", 90]] },
          ],
        },
        {
          "tank/home": [
            ["data", 60],
            ["snapshots", 40],
          ],
        },
      ],
    });
  });

  it("adds a free tile at the root when asked", () => {
    const root = buildSpaceHierarchy(datasets, { free: true });
    expect(root?.children.at(-1)).toMatchObject({ kind: "free", bytes: 700 });
  });

  it("gives each tile its own growth", () => {
    const growing = dataset(1, "tank", null, {
      growth: { used: 30, data: 10, snapshots: 20, sinceAt: "2026-09-05" },
    });
    expect(
      buildSpaceHierarchy([growing])?.children.map((tile) =>
        tile.kind === "dataset" ? null : [tile.kind, tile.growth],
      ),
    ).toEqual([
      ["data", 10],
      ["snapshots", 20],
    ]);
  });

  it("is null without a present root dataset", () => {
    expect(buildSpaceHierarchy([])).toBeNull();
    expect(
      buildSpaceHierarchy([dataset(1, "tank", null, { present: false })]),
    ).toBeNull();
  });
});
