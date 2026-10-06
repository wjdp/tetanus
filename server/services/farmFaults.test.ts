import { describe, expect, it } from "vitest";
import type { DiskSummary } from "~~/server/services/disks";
import { detectHeliumTripped } from "~~/server/services/farmFaults";

function disk(overrides: Record<string, unknown>) {
  return {
    id: 7,
    state: "active",
    disposal: null,
    latestFarm: null,
    ...overrides,
  };
}

const detect = (...rows: Record<string, unknown>[]) =>
  detectHeliumTripped({ disks: rows as unknown as DiskSummary[] });

describe("detectHeliumTripped", () => {
  it("raises an error when FARM reports a trip", () => {
    expect(
      detect(disk({ latestFarm: { heliumPressureTripped: true } })),
    ).toEqual([
      {
        kind: "helium-tripped",
        key: "7",
        subjectId: 7,
        severity: "error",
        data: {},
      },
    ]);
  });

  it("ignores a drive that has not tripped", () => {
    expect(
      detect(disk({ latestFarm: { heliumPressureTripped: false } })),
    ).toEqual([]);
  });

  it("ignores a FARM log without the flag", () => {
    expect(detect(disk({ latestFarm: {} }))).toEqual([]);
  });

  it("ignores a drive without FARM", () => {
    expect(detect(disk({}))).toEqual([]);
  });

  it("ignores a disk that is out of service", () => {
    expect(
      detect(
        disk({
          state: "retired",
          latestFarm: { heliumPressureTripped: true },
        }),
      ),
    ).toEqual([]);
  });

  it("ignores a disposed disk", () => {
    expect(
      detect(
        disk({
          disposal: { kind: "sold" },
          latestFarm: { heliumPressureTripped: true },
        }),
      ),
    ).toEqual([]);
  });
});
