import { describe, expect, it } from "vitest";
import { lastSegment, visibleTreeRows } from "./treeRows";

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
      [5, false],
    ]);
  });

  it("hides every descendant of a collapsed dataset", () => {
    expect(names([2])).toEqual(["tank", "tank/media", "tank/vm", "tank/old"]);
    expect(names([1])).toEqual(["tank"]);
  });

  it("puts destroyed datasets after present ones", () => {
    const shuffled = [datasets[4], ...datasets.slice(0, 4)];
    expect(
      visibleTreeRows(shuffled, new Set()).map((row) => row.dataset.id),
    ).toEqual([1, 2, 3, 4, 5]);
  });
});

describe("lastSegment", () => {
  it("takes the part after the last slash", () => {
    expect(lastSegment("tank/media/photos")).toBe("photos");
    expect(lastSegment("tank")).toBe("tank");
  });
});
