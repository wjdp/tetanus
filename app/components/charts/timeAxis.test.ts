import { describe, expect, it } from "vitest";
import { formatLegendTime, formatTick } from "./timeAxis";

const HOUR = 60 * 60;
const at = (...parts: [number, number, number, number, number]) =>
  new Date(parts[0], parts[1] - 1, parts[2], parts[3], parts[4]).getTime() /
  1000;

describe("formatTick", () => {
  it("shows ISO dates for day ticks", () => {
    expect(formatTick(at(2026, 9, 28, 0, 0), 24 * HOUR)).toBe("2026-09-28");
  });

  it("shows 24-hour times for sub-day ticks, dates at midnight", () => {
    expect(formatTick(at(2026, 9, 28, 18, 0), 6 * HOUR)).toBe("18:00");
    expect(formatTick(at(2026, 9, 29, 0, 0), 6 * HOUR)).toBe("2026-09-29");
  });
});

describe("formatLegendTime", () => {
  it("formats date and time", () => {
    expect(formatLegendTime(at(2026, 9, 28, 7, 5))).toBe("2026-09-28 07:05");
    expect(formatLegendTime(null)).toBe("—");
  });
});
