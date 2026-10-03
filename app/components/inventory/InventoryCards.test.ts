// @vitest-environment nuxt
import { mountSuspended } from "@nuxt/test-utils/runtime";
import { describe, expect, it } from "vitest";
import { NO_COUNTERS } from "#shared/smart/counters";
import InventoryCards from "./InventoryCards.vue";
import { emptyInventoryDisk, mirrorMembership } from "./testFixtures";
import type { InventoryDisk } from "./types";

const disk: InventoryDisk = emptyInventoryDisk({
  alias: "K1",
  model: "ST4000VN008",
  serial: "ZC100001",
  capacityBytes: 4e12,
  hostName: "mars",
  latestTemp: 34,
  tempThresholds: { warning: 45, error: 55 },
  latestPowerOnHours: 20_000,
  ageDays: 400,
  warrantyDaysLeft: 500,
  membership: mirrorMembership({ poolId: 3 }),
  usage: { kind: "zfs", fsTypes: ["zfs_member"], mounts: [], system: false },
  media: "hdd",
  rotationRate: 7200,
  interface: "sata",
  link: "sata",
  logicalBlockSize: 512,
  physicalBlockSize: 4096,
});

const mountCard = (overrides: Partial<InventoryDisk>) =>
  mountSuspended(InventoryCards, {
    props: { disks: [{ ...disk, ...overrides }] },
  });

describe("InventoryCards", () => {
  it("shows six core fields, whatever the table columns", async () => {
    const cards = await mountSuspended(InventoryCards, {
      props: { disks: [disk] },
    });
    const labels = cards.findAll("dt").map((dt) => dt.text());

    expect(labels).toEqual([
      "Capacity",
      "Media",
      "Host",
      "Pool",
      "Temp",
      "Power-on",
    ]);
  });

  it("shows usage and purpose in place of the pool when not in a pool", async () => {
    const cards = await mountCard({
      membership: null,
      usage: {
        kind: "filesystem",
        fsTypes: ["ext4"],
        mounts: [{ fsType: "ext4", path: "/boot", via: [] }],
        system: true,
      },
      purpose: "system",
      purposeInferred: true,
    });
    const field = cards.get('[data-testid="inventory-card-pool"]');

    expect(field.get("dt").text()).toBe("Usage");
    expect(field.get('[data-usage="filesystem"]').text()).toBe("ext4 /boot");
    expect(field.get("dd").text()).toContain("sys");
  });

  describe("attention row", () => {
    const attention = '[data-testid="inventory-card-attention"]';

    it("is absent for a healthy disk", async () => {
      const cards = await mountCard({
        counters: {
          ...NO_COUNTERS,
          reallocated: { value: 0, status: "passed" },
        },
      });

      expect(cards.find(attention).exists()).toBe(false);
    });

    it("shows fault badges", async () => {
      const cards = await mountCard({
        faultCounts: { error: 2, warning: 0, acknowledged: 0 },
      });

      expect(cards.get(attention).get('[data-bucket="error"]').text()).toBe(
        "2",
      );
    });

    it("shows a counter that is not passed, labelled", async () => {
      const cards = await mountCard({
        counters: {
          ...NO_COUNTERS,
          reallocated: { value: 0, status: "passed" },
          pending: { value: 8, status: "warning" },
        },
      });
      const row = cards.get(attention);

      expect(row.get('[data-counter="pending"]').text()).toBe("Pending 8");
      expect(row.find('[data-counter="reallocated"]').exists()).toBe(false);
    });

    it("shows a warranty close to expiry in warning colour", async () => {
      const cards = await mountCard({ warrantyDaysLeft: 21 });
      const warranty = cards
        .get(attention)
        .get('[data-testid="inventory-card-warranty"]');

      expect(warranty.text()).toBe("Warranty 21 d");
      expect(warranty.classes()).toContain("text-warning");
    });

    it("is absent for an expired warranty", async () => {
      const cards = await mountCard({ warrantyDaysLeft: -5 });

      expect(cards.find(attention).exists()).toBe(false);
    });
  });

  it("never nests a link inside the card link", async () => {
    const cards = await mountSuspended(InventoryCards, {
      props: { disks: [disk] },
    });

    expect(cards.findAll("a a")).toHaveLength(0);
    expect(cards.get('[data-testid="inventory-card-pool"]').text()).toContain(
      "tank",
    );
  });
});
