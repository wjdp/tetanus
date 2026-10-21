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
  const series = (from: number, step: number, length: number) =>
    Array.from({ length }, (_, index) => at(from + index * step));

  it("needs four regular gaps", () => {
    expect(learntIntervalMs(series(0, 1, 4))).toBeNull();
    expect(learntIntervalMs(series(0, 1, 5))).toBe(HOUR_MS);
  });

  it("takes the median of gaps within a quarter of it, whatever the order", () => {
    const jittered = [at(4.25), at(0), at(1), at(2.1), at(3.2)];
    expect(learntIntervalMs(jittered)).toBe(1.075 * HOUR_MS);
  });

  it("stays learning through hand-run pushes", () => {
    const pushes = [at(0), at(18), at(18.2), at(18.5), at(60), at(61)];
    expect(learntIntervalMs(pushes)).toBeNull();
  });

  it("learns from the newest regular run after hand-run pushes", () => {
    const pushes = [at(0), at(0.1), at(40)];
    expect(learntIntervalMs([...pushes, ...series(100, 24, 5)])).toBe(
      24 * HOUR_MS,
    );
  });

  it("learns short and long cadences alike", () => {
    const fiveMinutes = 5 / 60;
    expect(learntIntervalMs(series(0, fiveMinutes, 5))).toBeCloseTo(
      fiveMinutes * HOUR_MS,
    );
    expect(learntIntervalMs(series(0, 30 * 24, 5))).toBe(30 * 24 * HOUR_MS);
  });

  it("goes back to learning after a stray push", () => {
    expect(learntIntervalMs([...series(0, 1, 10), at(9.3)])).toBeNull();
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

  it("stalls while learning once the maximum interval has passed", () => {
    const learning = { intervalMs: null };
    expect(hourly({ ...learning, referenceAt: at(60 * 24) })).toEqual({
      status: "learning",
      dueAt: null,
      overdueMs: null,
    });
    expect(hourly({ ...learning, referenceAt: at(60 * 24 + 1) })).toEqual({
      status: "stalled",
      dueAt: at(60 * 24),
      overdueMs: HOUR_MS,
    });
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
