import { describe, expect, it } from "vitest";
import {
  allGroupFreshness,
  DEMO_CADENCES,
  formatDuration,
  isHostOffline,
  isHostSilent,
  MONITORED_SOURCES,
  sourceFreshness,
} from "./hostFreshness";

describe("sourceFreshness", () => {
  it("is ok within the cadence window", () => {
    const now = Date.now();
    const run = { receivedAt: new Date(now - 5 * 60_000), ok: true };
    expect(sourceFreshness("versions", run, now).status).toBe("ok");
  });

  it("is warning past 2x its group cadence", () => {
    const now = Date.now();
    const run = { receivedAt: new Date(now - 25 * 60_000), ok: true };
    expect(sourceFreshness("versions", run, now).status).toBe("warning");
  });

  it("is error when never seen", () => {
    expect(sourceFreshness("versions", undefined, Date.now()).status).toBe(
      "error",
    );
  });

  it("is error when the last run failed", () => {
    const now = Date.now();
    const run = { receivedAt: new Date(now - 60_000), ok: false };
    expect(sourceFreshness("versions", run, now).status).toBe("error");
  });
});

describe("allGroupFreshness", () => {
  it("covers zfs, smart and snapshots", () => {
    const groups = allGroupFreshness({}, Date.now());
    expect(groups.map((g) => g.name)).toEqual(["zfs", "smart", "snapshots"]);
    expect(groups.every((g) => g.status === "error")).toBe(true);
  });
});

describe("MONITORED_SOURCES", () => {
  it("excludes the event-driven zed-event source", () => {
    expect(MONITORED_SOURCES).not.toContain("zed-event");
  });
});

describe("isHostOffline", () => {
  const now = Date.parse("2026-09-29T12:00:00Z");
  const hoursAgo = (hours: number) => ({
    receivedAt: new Date(now - hours * 60 * 60_000),
    ok: true,
  });
  const staleRuns = {
    versions: hoursAgo(24),
    lsblk: hoursAgo(24),
    "zfs-snapshots": hoursAgo(24),
  };

  it("is offline when intermittent and every group is stale", () => {
    expect(
      isHostOffline({ intermittent: true, lastRuns: staleRuns }, now),
    ).toBe(true);
  });

  it("is offline when intermittent and never seen", () => {
    expect(isHostOffline({ intermittent: true, lastRuns: {} }, now)).toBe(true);
  });

  it("is online when any group is fresh", () => {
    const lastRuns = { ...staleRuns, versions: hoursAgo(0) };
    expect(isHostOffline({ intermittent: true, lastRuns }, now)).toBe(false);
  });

  it("is never offline when not intermittent", () => {
    expect(
      isHostOffline({ intermittent: false, lastRuns: staleRuns }, now),
    ).toBe(false);
  });
});

describe("isHostSilent", () => {
  const now = Date.parse("2026-09-29T12:00:00Z");
  const staleRuns = {
    versions: { receivedAt: new Date(now - 24 * 60 * 60_000), ok: true },
  };

  it("is silent when every group is stale", () => {
    expect(
      isHostSilent({ intermittent: false, lastRuns: staleRuns }, now),
    ).toBe(true);
  });

  it("is not silent when any group is fresh", () => {
    const lastRuns = { versions: { receivedAt: new Date(now), ok: true } };
    expect(isHostSilent({ intermittent: false, lastRuns }, now)).toBe(false);
  });

  it("is offline rather than silent when intermittent", () => {
    expect(isHostSilent({ intermittent: true, lastRuns: staleRuns }, now)).toBe(
      false,
    );
  });
});

describe("formatDuration", () => {
  it("formats minutes, hours and days", () => {
    expect(formatDuration(90_000)).toBe("2 min");
    expect(formatDuration(3 * 60 * 60_000)).toBe("3 h");
    expect(formatDuration(50 * 60 * 60_000)).toBe("2 d");
  });
});

describe("cadence overrides", () => {
  const now = Date.now();
  const twentyFiveMinutesAgo = {
    receivedAt: new Date(now - 25 * 60_000),
    ok: true,
  };

  it("sourceFreshness uses the override instead of the default cadence", () => {
    expect(
      sourceFreshness("versions", twentyFiveMinutesAgo, now, DEMO_CADENCES)
        .status,
    ).toBe("ok");
    expect(
      sourceFreshness("versions", twentyFiveMinutesAgo, now, { zfs: 60_000 })
        .status,
    ).toBe("warning");
  });

  it("falls back to the default cadence for groups not overridden", () => {
    const run = { receivedAt: new Date(now - 25 * 60_000), ok: true };
    expect(sourceFreshness("versions", run, now, { smart: 1 }).status).toBe(
      "warning",
    );
  });

  it("allGroupFreshness applies the demo cadences per group", () => {
    const at = (ms: number) => ({ receivedAt: new Date(now - ms), ok: true });
    const lastRuns = {
      "zpool-status": at(90 * 60_000),
      lsblk: at(90 * 60_000),
      "zfs-snapshots": at(5 * 60 * 60_000),
    };
    expect(
      allGroupFreshness(lastRuns, now).map((group) => group.status),
    ).toEqual(["warning", "ok", "ok"]);
    expect(
      allGroupFreshness(lastRuns, now, DEMO_CADENCES).map(
        (group) => group.status,
      ),
    ).toEqual(["ok", "ok", "ok"]);
  });
});
