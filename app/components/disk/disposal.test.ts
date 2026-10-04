import { describe, expect, it } from "vitest";
import { localToday } from "./disposal";

describe("localToday", () => {
  it("uses the local calendar day, not UTC", () => {
    expect(localToday(new Date(2026, 9, 3, 0, 30))).toBe("2026-10-03");
    expect(localToday(new Date(2026, 0, 9, 23, 59))).toBe("2026-01-09");
  });
});
