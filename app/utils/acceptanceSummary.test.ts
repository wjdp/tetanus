import { describe, expect, it } from "vitest";
import {
  acceptanceSummary,
  formatSpan,
  referenceValue,
  unchangedSince,
} from "./acceptanceSummary";

const DAY_MS = 24 * 60 * 60 * 1000;
const now = Date.parse("2026-09-28T12:00:00.000Z");
const daysAgo = (days: number, value: number) => ({
  at: new Date(now - days * DAY_MS).toISOString(),
  value,
});

describe("referenceValue", () => {
  const points = [
    daysAgo(40, 2),
    daysAgo(29, 8),
    daysAgo(8, 12),
    daysAgo(0, 16),
  ];

  it("takes the point nearest to the requested age", () => {
    expect(referenceValue(points, 7, now)).toBe(12);
    expect(referenceValue(points, 30, now)).toBe(8);
  });

  it("returns null when the history is shorter than the age", () => {
    expect(referenceValue([daysAgo(5, 1), daysAgo(0, 1)], 7, now)).toBeNull();
    expect(referenceValue([], 7, now)).toBeNull();
  });
});

describe("unchangedSince", () => {
  it("finds the start of the trailing run at the current value", () => {
    const points = [
      daysAgo(20, 16),
      daysAgo(10, 12),
      daysAgo(5, 16),
      daysAgo(0, 16),
    ];
    expect(unchangedSince(points, 16)).toBe(now - 5 * DAY_MS);
  });

  it("is null when the latest point differs", () => {
    expect(unchangedSince([daysAgo(1, 3)], 4)).toBeNull();
  });
});

describe("acceptanceSummary", () => {
  it("summarises value, duration and trend", () => {
    const points = [daysAgo(5, 16), daysAgo(2, 16), daysAgo(0, 16)];
    expect(acceptanceSummary(points, 16, "stable", now)).toBe(
      "16 for 5 days, stable",
    );
  });

  it("includes the unit and omits the duration without history", () => {
    expect(acceptanceSummary([], 51, "worsening", now, "°C")).toBe(
      "51 °C, worsening",
    );
  });
});

describe("formatSpan", () => {
  it("scales from hours to years", () => {
    expect(formatSpan(3 * 60 * 60 * 1000)).toBe("3 hours");
    expect(formatSpan(DAY_MS)).toBe("1 day");
    expect(formatSpan(14 * 30.44 * DAY_MS)).toBe("14 months");
    expect(formatSpan(3 * 365.25 * DAY_MS)).toBe("3.0 years");
  });
});
