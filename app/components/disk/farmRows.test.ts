import { describe, expect, it } from "vitest";
import type { SeagateFarm } from "#shared/smartctl";
import { farmHoursVerdict, headRows } from "./farmRows";

const farm = (overrides: Partial<SeagateFarm> = {}): SeagateFarm => ({
  interface: "ata",
  logVersion: "4.19",
  powerOnHours: 30_000,
  workload: {},
  errors: {},
  environment: {},
  perHead: [],
  ...overrides,
});

describe("farmHoursVerdict", () => {
  it.each([
    ["agrees", farm(), 30_000],
    ["reset", farm(), 1_000],
    ["not-comparable", farm({ logVersion: "3.7" }), 1_000],
    ["unknown", farm(), null],
    ["unknown", farm({ powerOnHours: undefined }), 1_000],
  ] as const)("%s", (verdict, value, smartHours) => {
    expect(farmHoursVerdict(value, smartHours)).toBe(verdict);
  });
});

describe("headRows", () => {
  it("numbers heads and flags resistance more than 20 % from the median", () => {
    const rows = headRows(
      farm({
        perHead: [
          { mrResistance: 400 },
          { mrResistance: 420 },
          { mrResistance: 480 },
          { mrResistance: 310 },
          {},
        ],
      }),
    );
    expect(rows.map((row) => [row.head, row.resistanceOutlier])).toEqual([
      [0, false],
      [1, false],
      [2, false],
      [3, true],
      [4, false],
    ]);
  });
});
