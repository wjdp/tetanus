import { describe, expect, it } from "vitest";
import { hoursAgo, NOW } from "./testFixtures";
import { dueText, lastSyncText } from "./timing";

describe("lastSyncText", () => {
  it("reads as an age", () => {
    expect(lastSyncText({ lastSyncAt: hoursAgo(3) }, NOW)).toBe("3 h ago");
    expect(lastSyncText({ lastSyncAt: null }, NOW)).toBe("never");
  });
});

describe("dueText", () => {
  it("counts down to the due time, then up while overdue", () => {
    expect(dueText({ dueAt: hoursAgo(-2), status: "ok" }, NOW)).toBe("in 2 h");
    expect(dueText({ dueAt: hoursAgo(5), status: "late" }, NOW)).toBe(
      "overdue 5 h",
    );
  });

  it("has nothing to say while learning or archived", () => {
    expect(dueText({ dueAt: null, status: "learning" }, NOW)).toBe("—");
    expect(dueText({ dueAt: hoursAgo(5), status: "archived" }, NOW)).toBe("—");
  });
});
