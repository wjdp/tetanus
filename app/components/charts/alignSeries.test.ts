import { describe, expect, it } from "vitest";
import { alignSeries } from "./alignSeries";

describe("alignSeries", () => {
  it("joins series on a shared, sorted time axis in epoch seconds", () => {
    const data = alignSeries([
      {
        label: "a",
        points: [
          { at: "2026-01-01T00:00:10Z", value: 2 },
          { at: "2026-01-01T00:00:00Z", value: 1 },
        ],
      },
      {
        label: "b",
        points: [{ at: new Date("2026-01-01T00:00:05Z"), value: 9 }],
      },
    ]);

    const start = Date.parse("2026-01-01T00:00:00Z") / 1000;
    expect(data).toEqual([
      [start, start + 5, start + 10],
      [1, null, 2],
      [null, 9, null],
    ]);
  });

  it("returns an empty axis without points", () => {
    expect(alignSeries([{ label: "a", points: [] }])).toEqual([[], []]);
  });
});
