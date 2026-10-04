import { describe, expect, it } from "vitest";
import { hoursAgo, NOW } from "./testFixtures";
import { dueText, lastSyncText, statusText } from "./timing";

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

  it("says due rather than overdue while still within the late threshold", () => {
    expect(dueText({ dueAt: hoursAgo(1), status: "ok" }, NOW)).toBe(
      "due 1 h ago",
    );
  });

  it("has nothing to say while learning or archived", () => {
    expect(dueText({ dueAt: null, status: "learning" }, NOW)).toBe("—");
    expect(dueText({ dueAt: hoursAgo(5), status: "archived" }, NOW)).toBe("—");
  });
});

describe("statusText", () => {
  it("says when a measured replication is due, or how far overdue", () => {
    expect(statusText({ dueAt: hoursAgo(-2), status: "ok" }, NOW)).toBe(
      "Due in 2 h",
    );
    expect(statusText({ dueAt: hoursAgo(1), status: "ok" }, NOW)).toBe(
      "Due 1 h ago",
    );
    expect(statusText({ dueAt: hoursAgo(13), status: "late" }, NOW)).toBe(
      "Late · 13 h overdue",
    );
    expect(statusText({ dueAt: hoursAgo(48), status: "stalled" }, NOW)).toBe(
      "Stalled · 2 d overdue",
    );
  });

  it("names the state when there is no schedule to speak of", () => {
    expect(
      statusText({ dueAt: hoursAgo(-1), status: "target-gone" }, NOW),
    ).toBe("Target gone");
    expect(
      statusText({ dueAt: hoursAgo(-1), status: "source-gone" }, NOW),
    ).toBe("Source gone");
    expect(statusText({ dueAt: null, status: "learning" }, NOW)).toBe(
      "Learning",
    );
    expect(dueText({ dueAt: hoursAgo(-1), status: "target-gone" }, NOW)).toBe(
      "—",
    );
  });
});
