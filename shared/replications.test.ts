import { describe, expect, it } from "vitest";
import {
  DEFAULT_REPLICATION_THRESHOLDS,
  learntIntervalMs,
  type ReplicationHealthInput,
  replicationHealth,
} from "./replications";

const HOUR_MS = 60 * 60 * 1000;
const at = (hours: number) =>
  new Date(Date.parse("2026-10-01T00:00:00Z") + hours * HOUR_MS);

describe("learntIntervalMs", () => {
  it("needs three syncs", () => {
    expect(learntIntervalMs([at(0), at(1)])).toBeNull();
    expect(learntIntervalMs([at(0), at(1), at(2)])).toBe(HOUR_MS);
  });

  it("takes the median gap whatever the order", () => {
    expect(learntIntervalMs([at(5), at(0), at(1), at(2), at(30)])).toBe(
      2 * HOUR_MS,
    );
  });

  it("looks at the newest ten syncs only", () => {
    const daily = Array.from({ length: 20 }, (_, day) => at(day * 24));
    const hourly = Array.from({ length: 10 }, (_, hour) => at(1000 + hour));
    expect(learntIntervalMs([...daily, ...hourly])).toBe(HOUR_MS);
  });
});

describe("replicationHealth", () => {
  const hourly = (overrides: Partial<ReplicationHealthInput> = {}) =>
    replicationHealth(
      {
        archived: false,
        targetGone: false,
        sourceGone: false,
        lastSyncAt: at(0),
        intervalMs: HOUR_MS,
        referenceAt: at(1),
        ...overrides,
      },
      DEFAULT_REPLICATION_THRESHOLDS,
    );

  it("is ok until the late floor has passed beyond the due time", () => {
    expect(hourly({ referenceAt: at(4) })).toEqual({
      status: "ok",
      dueAt: at(1),
      overdueMs: 3 * HOUR_MS,
    });
    expect(hourly({ referenceAt: at(4.1) }).status).toBe("late");
  });

  it("stalls past the stalled floor", () => {
    expect(hourly({ referenceAt: at(49) }).status).toBe("late");
    expect(hourly({ referenceAt: at(49.1) }).status).toBe("stalled");
  });

  it("scales the thresholds with a long interval", () => {
    const daily = { intervalMs: 24 * HOUR_MS };
    expect(hourly({ ...daily, referenceAt: at(36) }).status).toBe("ok");
    expect(hourly({ ...daily, referenceAt: at(36.1) }).status).toBe("late");
    expect(hourly({ ...daily, referenceAt: at(72.1) }).status).toBe("stalled");
  });

  it("is learning without an interval or a sync", () => {
    expect(hourly({ intervalMs: null }).status).toBe("learning");
    expect(hourly({ lastSyncAt: null }).status).toBe("learning");
  });

  it("puts archived before target gone before source gone before anything measured", () => {
    const stalled = { referenceAt: at(100) };
    const bothGone = { targetGone: true, sourceGone: true };
    expect(hourly({ ...stalled, sourceGone: true }).status).toBe("source-gone");
    expect(hourly({ ...stalled, targetGone: true }).status).toBe("target-gone");
    expect(hourly({ ...stalled, ...bothGone }).status).toBe("target-gone");
    expect(hourly({ ...stalled, ...bothGone, archived: true }).status).toBe(
      "archived",
    );
  });
});
