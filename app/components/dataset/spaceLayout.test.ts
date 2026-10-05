import { describe, expect, it } from "vitest";
import { buildSpaceHierarchy, type SpaceDataset } from "./spaceHierarchy";
import {
  BRANCH_SLOTS,
  branchSlots,
  growthScale,
  HEADER_HEIGHT,
  layoutSpace,
} from "./spaceLayout";

const dataset = (
  id: number,
  parentId: number | null,
  used: number,
): SpaceDataset => ({
  id,
  name: parentId === null ? "tank" : `tank/${id}`,
  parentId,
  present: true,
  used,
  available: 0,
  usedByDataset: null,
  usedBySnapshots: null,
  usedByChildren: null,
  growth: null,
});

const pool = (sizes: number[]) => {
  const children = sizes.map((used, index) => dataset(index + 2, 1, used));
  const root = dataset(
    1,
    null,
    children.reduce((sum, child) => sum + child.used, 0),
  );
  const tree = buildSpaceHierarchy([root, ...children]);
  if (!tree) throw new Error("no tree");
  return tree;
};

describe("layoutSpace", () => {
  it("sizes tiles by bytes and fills the area", () => {
    const laid = layoutSpace(pool([300, 100]), 400, 200);
    expect(laid.value).toBe(400);
    const [big, small] = laid.children ?? [];
    const area = (node: typeof big) =>
      node ? (node.x1 - node.x0) * (node.y1 - node.y0) : 0;
    expect(area(big)).toBeGreaterThan(area(small) * 2);
  });

  it("gives big first-level boxes a header strip", () => {
    const laid = layoutSpace(pool([300, 100]), 400, 200);
    const box = laid.children?.[0];
    const tile = box?.children?.[0];
    expect(box && tile ? tile.y0 - box.y0 : 0).toBe(HEADER_HEIGHT);
  });

  it("stacks a dataset's own tiles with snapshots under data, whatever their size", () => {
    const tree = buildSpaceHierarchy([
      {
        ...dataset(1, null, 300),
        usedByDataset: 100,
        usedBySnapshots: 200,
        usedByChildren: 0,
      },
    ]);
    if (!tree) throw new Error("no tree");
    const laid = layoutSpace(tree, 400, 200);
    const tile = (key: string) =>
      laid.descendants().find((node) => node.data.key === key);
    const data = tile("1:data");
    const snapshots = tile("1:snapshots");
    expect(snapshots?.y0).toBeGreaterThan(data?.y1 ?? Infinity);
    expect(snapshots?.x0).toBe(data?.x0);
  });
});

describe("branchSlots", () => {
  it("colours the biggest branches and folds the rest into other", () => {
    const sizes = Array.from({ length: BRANCH_SLOTS + 2 }, (_, i) => 100 - i);
    const slots = branchSlots(pool(sizes));
    expect(slots.get(1)).toBeNull();
    expect(slots.get(2)).toBe(0);
    expect(slots.get(BRANCH_SLOTS + 1)).toBe(BRANCH_SLOTS - 1);
    expect(slots.get(BRANCH_SLOTS + 2)).toBeNull();
  });
});

describe("growthScale", () => {
  it("is zero-centred, signed and clamped", () => {
    const growths = [
      ...Array.from({ length: 98 }, (_, i) => (i + 1) * 1e6),
      1e12,
      null,
    ];
    const { position, clamp } = growthScale(growths);
    expect(clamp).toBeLessThan(1e12);
    expect(position(0)).toBe(0);
    expect(position(1e12)).toBe(1);
    expect(position(-1e12)).toBe(-1);
    expect(position(1e6)).toBeGreaterThan(0);
    expect(position(1e6)).toBeLessThan(position(5e7));
  });

  it("puts everything at the midpoint without any growth", () => {
    expect(growthScale([null, 0]).position(5)).toBe(0);
  });
});
