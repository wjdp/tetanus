import { describe, expect, it } from "vitest";
import { REPLICATION_STATUSES } from "#shared/replications";
import {
  formatCadence,
  REPLICATION_STATUS_VOCABULARY,
  worstReplicationStatus,
} from "./replication";

const HOUR = 3600;
const DAY = 24 * HOUR;

describe("REPLICATION_STATUS_VOCABULARY", () => {
  it.each(REPLICATION_STATUSES)("has an entry for %s", (status) => {
    expect(REPLICATION_STATUS_VOCABULARY[status].label).toBeTruthy();
  });

  it.each([
    ["ok", "neutral", "filled"],
    ["late", "warning", "filled"],
    ["stalled", "error", "filled"],
    ["learning", "neutral", "hollow"],
    ["target-gone", "error", "filled"],
    ["source-gone", "neutral", "hollow"],
    ["archived", "neutral", "hollow"],
  ] as const)("draws %s as a %s %s dot", (status, colour, shape) => {
    expect(REPLICATION_STATUS_VOCABULARY[status]).toMatchObject({
      colour,
      shape,
    });
  });
});

describe("worstReplicationStatus", () => {
  it("ranks target gone over stalled over late over the quiet statuses", () => {
    expect(worstReplicationStatus(["stalled", "target-gone"])).toBe(
      "target-gone",
    );
    expect(worstReplicationStatus(["learning", "source-gone"])).toBe(
      "source-gone",
    );
    expect(worstReplicationStatus(["ok", "stalled", "late"])).toBe("stalled");
    expect(worstReplicationStatus(["ok", "late", "learning"])).toBe("late");
    expect(worstReplicationStatus(["ok", "archived"])).toBe("ok");
    expect(worstReplicationStatus([])).toBe("archived");
  });
});

describe("formatCadence", () => {
  it.each([
    [HOUR, "hourly"],
    [HOUR + 30, "hourly"],
    [DAY - 60, "daily"],
    [1.1 * DAY, "~daily"],
    [7 * DAY, "weekly"],
    [6 * HOUR, "every 6 h"],
    [15 * 60, "every 15 min"],
    [90 * 60, "every 90 min"],
    [6.5 * HOUR, "every ~7 h"],
    [3 * DAY, "every 3 d"],
  ])("formats a learnt %i s as %s", (seconds, label) => {
    expect(formatCadence(seconds)).toBe(label);
  });

  it("names a manual interval only when it matches exactly", () => {
    expect(formatCadence(DAY, true)).toBe("daily");
    expect(formatCadence(7.5 * HOUR, true)).toBe("every ~8 h");
    expect(formatCadence(12 * HOUR, true)).toBe("every 12 h");
  });

  it("says learning without an interval", () => {
    expect(formatCadence(null)).toBe("learning");
  });
});
