import { describe, expect, it } from "vitest";
import { sortDisks } from "./inventorySort";
import type { InventoryDisk } from "./types";

const disk = (
  id: number,
  overrides: Partial<InventoryDisk>,
): InventoryDisk => ({
  id,
  alias: null,
  model: null,
  serial: null,
  capacityBytes: null,
  hostName: null,
  state: "in-use",
  stateOverride: null,
  latestStatus: "passed",
  latestTemp: null,
  latestPowerOnHours: null,
  ageDays: null,
  warrantyDaysLeft: null,
  inventory: {},
  membership: null,
  ...overrides,
});

const ids = (disks: InventoryDisk[]) => disks.map(({ id }) => id);

describe("sortDisks", () => {
  const disks = [
    disk(1, { alias: null, latestTemp: 40 }),
    disk(2, { alias: "K10", latestTemp: null }),
    disk(3, { alias: "K2", latestTemp: 35 }),
  ];

  it("sorts aliases naturally with missing values last", () => {
    expect(ids(sortDisks(disks, [{ id: "alias", desc: false }]))).toEqual([
      3, 2, 1,
    ]);
  });

  it("keeps missing values last when descending", () => {
    expect(ids(sortDisks(disks, [{ id: "temp", desc: true }]))).toEqual([
      1, 3, 2,
    ]);
  });

  it("leaves order alone for an unknown field", () => {
    expect(ids(sortDisks(disks, [{ id: "nope", desc: false }]))).toEqual([
      1, 2, 3,
    ]);
  });
});
