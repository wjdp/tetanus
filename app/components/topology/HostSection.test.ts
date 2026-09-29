// @vitest-environment nuxt
import { mountSuspended } from "@nuxt/test-utils/runtime";
import { describe, expect, it } from "vitest";
import { defineComponent } from "vue";
import type { TopologyDisk, TopologyPool } from "./groupDisks";
import HostSection from "./HostSection.vue";
import { diskFixture } from "./testFixtures";

const TooltipPassthrough = defineComponent({
  setup:
    (_, { slots }) =>
    () =>
      slots.default?.(),
});

const host = { id: 1, name: "mars", displayName: null, lastRuns: {} };

const pool: TopologyPool = {
  id: 7,
  name: "tank",
  state: "ONLINE",
  sizeBytes: null,
  allocBytes: null,
  cap: null,
  frag: null,
  scan: null,
  vdevs: null,
};

const onMars = (id: number, overrides: Partial<TopologyDisk> = {}) =>
  diskFixture(id, { lastSeenHostId: 1, present: true, ...overrides });

const mountHost = (
  pools: TopologyPool[],
  disks: TopologyDisk[],
  inPool = new Set<number>(),
) =>
  mountSuspended(HostSection, {
    props: { host, pools, disks, inPool, now: Date.now() },
    global: { stubs: { UTooltip: TooltipPassthrough } },
  });

describe("TopologyHostSection", () => {
  it("summarises disk counts by media and raw capacity", async () => {
    const section = await mountHost(
      [pool],
      [
        onMars(1, { media: "hdd", capacityBytes: 88e12 }),
        onMars(2, { media: "hdd", capacityBytes: 88e12, present: false }),
        onMars(3, { media: "ssd", capacityBytes: null }),
      ],
      new Set([1, 2, 3]),
    );

    expect(section.get('[data-testid="host-summary"]').text()).toBe(
      "3 disks · 2 HDD · 1 SSD · 176 TB raw",
    );
  });

  it("omits zero media counts and unknown capacity", async () => {
    const section = await mountHost([pool], [onMars(1, { media: "ssd" })]);

    expect(section.get('[data-testid="host-summary"]').text()).toBe(
      "1 disk · 1 SSD",
    );
  });

  it("lists live disks outside pools in an Other disks card", async () => {
    const section = await mountHost(
      [pool],
      [
        onMars(1),
        onMars(2, { state: "dead", alias: "RMA1" }),
        onMars(3, { state: "spare", purpose: "system", alias: "BOOT" }),
      ],
      new Set([1]),
    );

    const card = section.get('[data-testid="other-disks-card"]');
    expect(card.text()).toContain("Other disks");
    const rows = card.findAll('[data-testid="host-disk-group"]');
    expect(rows.map((row) => row.text())).toEqual([
      expect.stringContaining("BOOT"),
      expect.stringContaining("RMA1"),
    ]);
    expect(rows[0]?.text()).toContain("system");
    expect(rows[1]?.text()).toContain("other");
    expect(
      rows[1]?.get('[data-testid="disk-tile-state-mark"]').attributes("title"),
    ).toBe("Dead");
    expect(section.findAll('[data-testid="pool-card"]')).toHaveLength(1);
  });

  it("has no Other disks card when every live disk is in a pool", async () => {
    const section = await mountHost([pool], [onMars(1)], new Set([1]));

    expect(section.find('[data-testid="other-disks-card"]').exists()).toBe(
      false,
    );
  });

  it("shows only the Other disks card for a pool-less host with live disks", async () => {
    const section = await mountHost([], [onMars(1, { state: "spare" })]);

    expect(section.text()).not.toContain("No pools reported yet.");
    expect(section.find('[data-testid="other-disks-card"]').exists()).toBe(
      true,
    );
  });

  it("says no pools have been reported when the host has nothing live", async () => {
    const section = await mountHost([], [onMars(1, { present: false })]);

    expect(section.text()).toContain("No pools reported yet.");
    expect(section.find('[data-testid="other-disks-card"]').exists()).toBe(
      false,
    );
  });
});
