import { describe, expect, it } from "vitest";
import type { SeagateFarm } from "#shared/smartctl";
import {
  farmHoursComparable,
  farmIdentityMismatches,
  smartResetHours,
} from "./farm";

const farm = (overrides: Partial<SeagateFarm> = {}): SeagateFarm => ({
  interface: "ata",
  logVersion: "4.19",
  powerOnHours: 30_000,
  serial: "ZA1",
  wwn: "5000c500aaaaaaaa",
  workload: {},
  errors: {},
  environment: {},
  perHead: [],
  ...overrides,
});

describe("smartResetHours", () => {
  it.each([
    ["agreeing counters", 30_000, null],
    ["drift between readings", 29_999, null],
    ["a gap under 5 % of FARM hours", 28_600, null],
    ["a reset", 1_000, 29_000],
    ["missing SMART hours", null, null],
  ])("%s", (_case, smartHours, expected) => {
    expect(smartResetHours(farm(), smartHours)).toBe(expected);
  });

  it("needs at least 48 h on a young drive", () => {
    expect(smartResetHours(farm({ powerOnHours: 100 }), 60)).toBeNull();
    expect(smartResetHours(farm({ powerOnHours: 100 }), 40)).toBe(60);
  });

  it("skips SMART hours that look like a 16-bit wrap", () => {
    expect(smartResetHours(farm({ powerOnHours: 70_000 }), 4_464)).toBeNull();
    expect(smartResetHours(farm({ powerOnHours: 70_000 }), 1_000)).toBe(69_000);
  });

  it("compares FARM 3.x and later, not older logs", () => {
    expect(farmHoursComparable(farm({ logVersion: "3.7" }))).toBe(true);
    expect(farmHoursComparable(farm({ logVersion: "2.1" }))).toBe(false);
    expect(smartResetHours(farm({ logVersion: "2.1" }), 1_000)).toBeNull();
    expect(smartResetHours(farm({ logVersion: undefined }), 1_000)).toBeNull();
  });
});

describe("farmIdentityMismatches", () => {
  it("matches serial and any of the drive's WWNs", () => {
    expect(
      farmIdentityMismatches(farm(), {
        serial: "ZA1 ",
        wwns: ["5000c500bbbbbbbb", "5000c500aaaaaaaa"],
      }),
    ).toEqual([]);
  });

  it("names each field that differs", () => {
    expect(
      farmIdentityMismatches(farm(), {
        serial: "ZB2",
        wwns: ["5000c500bbbbbbbb"],
      }),
    ).toEqual(["serial", "wwn"]);
  });

  it("skips fields the drive does not report", () => {
    expect(farmIdentityMismatches(farm(), { serial: null, wwns: [] })).toEqual(
      [],
    );
  });
});
