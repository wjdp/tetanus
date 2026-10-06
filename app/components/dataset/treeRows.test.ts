import { describe, expect, it } from "vitest";
import { lastSegment, sortSiblings, visibleTreeRows } from "./treeRows";

const dataset = (
  id: number,
  name: string,
  parentId: number | null,
  present = true,
) => ({ id, name, parentId, present });

const datasets = [
  dataset(1, "tank", null),
  dataset(2, "tank/media", 1),
  dataset(3, "tank/media/photos", 2),
  dataset(4, "tank/vm", 1),
  dataset(5, "tank/old", 1, false),
  dataset(6, "tank/old/child", 5, false),
];

const names = (collapsed: number[]) =>
  visibleTreeRows(datasets, new Set(collapsed)).map((row) => row.dataset.name);

describe("visibleTreeRows", () => {
  it("keeps tree order and marks rows with children", () => {
    const rows = visibleTreeRows(datasets, new Set());
    expect(rows.map((row) => [row.dataset.id, row.hasChildren])).toEqual([
      [1, true],
      [2, true],
      [3, false],
      [4, false],
      [5, true],
      [6, false],
    ]);
  });

  it("hides every descendant of a collapsed dataset", () => {
    expect(names([2])).toEqual([
      "tank",
      "tank/media",
      "tank/vm",
      "tank/old",
      "tank/old/child",
    ]);
    expect(names([5])).toEqual([
      "tank",
      "tank/media",
      "tank/media/photos",
      "tank/vm",
      "tank/old",
    ]);
  });

  it("keeps destroyed datasets visible when a present parent collapses", () => {
    expect(names([1])).toEqual(["tank", "tank/old", "tank/old/child"]);
  });

  it("puts destroyed datasets after present ones", () => {
    const shuffled = [datasets[4], datasets[5], ...datasets.slice(0, 4)];
    expect(
      visibleTreeRows(shuffled, new Set()).map((row) => row.dataset.id),
    ).toEqual([1, 2, 3, 4, 5, 6]);
  });
});

describe("lastSegment", () => {
  it("takes the part after the last slash", () => {
    expect(lastSegment("tank/media/photos")).toBe("photos");
    expect(lastSegment("tank")).toBe("tank");
  });
});

describe("sortSiblings", () => {
  const byNameDescending = (a: { name: string }, b: { name: string }) =>
    b.name.localeCompare(a.name);

  it("reorders siblings and keeps each dataset under its parent", () => {
    expect(
      sortSiblings(datasets, byNameDescending).map((row) => row.name),
    ).toEqual([
      "tank",
      "tank/vm",
      "tank/old",
      "tank/old/child",
      "tank/media",
      "tank/media/photos",
    ]);
  });

  it("treats a dataset whose parent is not listed as a root", () => {
    const orphans = [
      dataset(3, "tank/media/photos", 2),
      dataset(4, "tank/vm", 1),
    ];
    expect(
      sortSiblings(orphans, byNameDescending).map((row) => row.name),
    ).toEqual(["tank/vm", "tank/media/photos"]);
  });
});
