import { describe, expect, it } from "vitest";
import { byteUnitFor, formatBytes, formatDays, formatHours } from "./format";

describe("formatBytes", () => {
  it("uses decimal units like zfs list and disk labels", () => {
    expect(formatBytes(12_000_138_625_024)).toBe("12.0 TB");
    expect(formatBytes(500_107_862_016)).toBe("500 GB");
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(null)).toBe("—");
  });
});

describe("formatHours", () => {
  it("scales to days and years", () => {
    expect(formatHours(5)).toBe("5 h");
    expect(formatHours(240)).toBe("10 d");
    expect(formatHours(30_000)).toBe("3.4 y");
  });
});

describe("formatDays", () => {
  it("scales to years past one", () => {
    expect(formatDays(200)).toBe("200 d");
    expect(formatDays(800)).toBe("2.2 y");
  });
});

describe("byteUnitFor", () => {
  it("picks the largest decimal unit the value reaches", () => {
    expect(byteUnitFor(12_000_138_625_024)).toEqual({
      unit: "TB",
      divisor: 1e12,
    });
    expect(byteUnitFor(500_107_862_016)).toEqual({ unit: "GB", divisor: 1e9 });
    expect(byteUnitFor(12)).toEqual({ unit: "B", divisor: 1 });
  });
});
