// @vitest-environment nuxt
import { mountSuspended } from "@nuxt/test-utils/runtime";
import { describe, expect, it } from "vitest";
import ScanPanel from "./ScanPanel.vue";
import type { PoolScan } from "./scan";

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const START = 1_790_000_000;
const NOW = START * 1000 + 10 * HOUR_MS;

const finished: PoolScan = {
  function: "SCRUB",
  state: "FINISHED",
  startTime: START,
  endTime: START + 3600,
  examined: 100,
  toExamine: 100,
  processed: 0,
  errors: 0,
};

const running: PoolScan = {
  ...finished,
  state: "SCANNING",
  endTime: undefined,
  examined: 25,
};

const mountPanel = (props: Partial<InstanceType<typeof ScanPanel>["$props"]>) =>
  mountSuspended(ScanPanel, {
    props: {
      scan: finished,
      lastScrub: null,
      scanProgressAt: null,
      firstSeenAt: new Date(START * 1000).toISOString(),
      scrubIntervalDays: 35,
      now: NOW,
      ...props,
    },
  });

describe("ScanPanel", () => {
  it("shows a finished scrub's duration and repairs", async () => {
    const panel = await mountPanel({});
    expect(panel.get('[data-testid="scan-state"]').text()).toBe("finished");
    expect(panel.text()).toContain("Duration1 h");
    expect(panel.get('[data-testid="scan-repaired"]').text()).toBe("0 B");
    expect(panel.find('[data-testid="scrub-overdue"]').exists()).toBe(false);
  });

  it("calls a cancelled scan cancelled", async () => {
    const panel = await mountPanel({
      scan: { ...finished, state: "CANCELED" },
    });
    expect(panel.get('[data-testid="scan-state"]').text()).toBe("cancelled");
  });

  it("shows a paused scrub with when it paused", async () => {
    const panel = await mountPanel({
      scan: { ...running, pausedAt: START + 7200 },
    });
    expect(panel.get('[data-testid="scan-state"]').text()).toBe("paused");
    expect(panel.get('[data-testid="scan-progress"]').text()).toContain(
      "paused since",
    );
  });

  it("says when a running scan last made progress once it stalls", async () => {
    const stalledAt = new Date(NOW - 7 * HOUR_MS).toISOString();
    const panel = await mountPanel({
      scan: running,
      scanProgressAt: stalledAt,
    });
    expect(panel.get('[data-testid="scan-progress"]').text()).toContain(
      "no progress since",
    );

    const moving = await mountPanel({
      scan: running,
      scanProgressAt: new Date(NOW - HOUR_MS).toISOString(),
    });
    expect(moving.get('[data-testid="scan-progress"]').text()).toContain(
      "left",
    );
  });

  it("shows the last scrub beside a resilver that replaced it", async () => {
    const panel = await mountPanel({
      scan: { ...finished, function: "RESILVER" },
      lastScrub: {
        endAt: new Date(START * 1000 - DAY_MS).toISOString(),
        errors: 2,
        repairedBytes: 4096,
        durationS: 7200,
      },
    });
    const lastScrub = panel.get('[data-testid="last-scrub"]');
    expect(lastScrub.text()).toContain("2 errors");
    expect(lastScrub.text()).toContain("repaired 4.00 KiB");
    expect(lastScrub.text()).toContain("took 2 h");
    expect(lastScrub.classes()).toContain("text-error");
  });

  it("hides the last scrub when it is the current scan", async () => {
    const panel = await mountPanel({
      lastScrub: {
        endAt: new Date((START + 3600) * 1000).toISOString(),
        errors: 0,
        repairedBytes: 0,
        durationS: 3600,
      },
    });
    expect(panel.find('[data-testid="last-scrub"]').exists()).toBe(false);
  });

  it("warns when the scrub is overdue, unless the interval is off", async () => {
    const later = NOW + 40 * DAY_MS;
    const overdue = await mountPanel({ now: later });
    const warning = overdue.get('[data-testid="scrub-overdue"]');
    expect(warning.text()).toMatch(
      /Scrub overdue: last scrubbed 40 d ago,\s+interval 35 d/,
    );
    expect(warning.classes()).toContain("text-warning");

    const off = await mountPanel({ now: later, scrubIntervalDays: 0 });
    expect(off.find('[data-testid="scrub-overdue"]').exists()).toBe(false);
  });

  it("counts a never-scrubbed pool from when it was first seen", async () => {
    const panel = await mountPanel({
      scan: null,
      now: START * 1000 + 36 * DAY_MS,
    });
    expect(panel.get('[data-testid="scrub-overdue"]').text()).toContain(
      "never scrubbed",
    );
  });
});
