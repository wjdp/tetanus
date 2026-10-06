import { describe, expect, it } from "vitest";
import {
  type DatasetColumn,
  datasetComparator,
  findDatasetColumn,
  nextSorting,
} from "./columns";
import type { DatasetTreeRow } from "./types";

const row = (name: string, extra: Partial<DatasetTreeRow> = {}) =>
  ({ name, used: 0, growth: null, ...extra }) as DatasetTreeRow;

const sortedNames = (
  rows: DatasetTreeRow[],
  sorting: { id: string; desc: boolean },
) => [...rows].sort(datasetComparator(sorting)).map(({ name }) => name);

const column = (id: string) => findDatasetColumn(id) as DatasetColumn;

describe("datasetComparator", () => {
  it("orders names by their last segment, numerically", () => {
    const rows = [
      row("tank/b/disk10"),
      row("tank/a/disk2"),
      row("tank/c/alpha"),
    ];
    expect(sortedNames(rows, { id: "name", desc: false })).toEqual([
      "tank/c/alpha",
      "tank/a/disk2",
      "tank/b/disk10",
    ]);
  });

  it("keeps datasets without a value last in both directions", () => {
    const growth = (used: number) => ({
      used,
      data: used,
      snapshots: 0,
      sinceAt: "2026-09-01T00:00:00.000Z",
    });
    const rows = [
      row("none"),
      row("small", { growth: growth(1) }),
      row("large", { growth: growth(9) }),
    ];
    expect(sortedNames(rows, { id: "growth", desc: true })).toEqual([
      "large",
      "small",
      "none",
    ]);
    expect(sortedNames(rows, { id: "growth", desc: false })).toEqual([
      "small",
      "large",
      "none",
    ]);
  });
});

describe("nextSorting", () => {
  it("starts sizes largest first, then reverses, then clears", () => {
    const first = nextSorting(null, column("used"));
    expect(first).toEqual({ id: "used", desc: true });
    const second = nextSorting(first, column("used"));
    expect(second).toEqual({ id: "used", desc: false });
    expect(nextSorting(second, column("used"))).toBeNull();
  });

  it("starts names ascending and switches column from any state", () => {
    expect(nextSorting({ id: "used", desc: false }, column("name"))).toEqual({
      id: "name",
      desc: false,
    });
  });
});
