import { describe, expect, it } from "vitest";
import { isScanActive, type PoolScan, scanProgress } from "./scan";

const HOUR_MS = 60 * 60 * 1000;

const running: PoolScan = {
  function: "SCRUB",
  state: "SCANNING",
  startTime: 1_000_000,
  examined: 25,
  toExamine: 100,
  errors: 0,
};

describe("isScanActive", () => {
  it("treats finished, and cancelled scans as idle", () => {
    expect(isScanActive(running)).toBe(true);
    expect(isScanActive({ ...running, state: "FINISHED" })).toBe(false);
    expect(isScanActive({ ...running, state: "CANCELED" })).toBe(false);
  });
});

describe("scanProgress", () => {
  it("estimates time left from the examined rate", () => {
    const now = running.startTime * 1000 + HOUR_MS;
    expect(scanProgress(running, now)).toEqual({
      verb: "scrub",
      percent: 25,
      msLeft: 3 * HOUR_MS,
    });
  });

  it("gives no estimate before anything is examined", () => {
    expect(scanProgress({ ...running, examined: 0 }, Date.now()).msLeft).toBe(
      null,
    );
  });

  it("gives no estimate while paused", () => {
    const now = running.startTime * 1000 + HOUR_MS;
    expect(
      scanProgress({ ...running, pausedAt: running.startTime + 60 }, now)
        .msLeft,
    ).toBe(null);
  });
});
