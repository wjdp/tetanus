import { describe, expect, it } from "vitest";
import { capacitySeries } from "./capacityChart";

const TIB = 2 ** 40;

const reading = (
  at: string,
  allocBytes: number | null,
  usedBytes: number | null = null,
  availableBytes: number | null = null,
) => ({ at, allocBytes, usedBytes, availableBytes });

describe("capacitySeries", () => {
  it("plots usable used under used + available, skipping readings without them", () => {
    const chart = capacitySeries(
      [
        reading("2026-10-01", 9 * TIB),
        reading("2026-10-02", 9 * TIB, 4 * TIB, 2 * TIB),
      ],
      "binary",
    );
    expect(chart).toEqual({
      unit: "TiB",
      series: [
        { label: "Used", points: [{ at: "2026-10-02", value: 4 }] },
        { label: "Used + available", points: [{ at: "2026-10-02", value: 6 }] },
      ],
    });
  });

  it("falls back to raw alloc without any usable readings", () => {
    const chart = capacitySeries(
      [reading("2026-10-01", 2e12), reading("2026-10-02", null)],
      "decimal",
    );
    expect(chart).toEqual({
      unit: "TB",
      series: [
        { label: "Allocated, raw", points: [{ at: "2026-10-01", value: 2 }] },
      ],
    });
  });
});
