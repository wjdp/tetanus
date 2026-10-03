// @vitest-environment nuxt
import { mountSuspended } from "@nuxt/test-utils/runtime";
import { describe, expect, it } from "vitest";
import InventoryCards from "./InventoryCards.vue";
import type { InventoryDisk } from "./types";

const disk: InventoryDisk = {
  id: 1,
  alias: "K1",
  model: "ST4000VN008",
  serial: "ZC100001",
  capacityBytes: 4e12,
  hostName: "mars",
  state: "in-use",
  stateOverride: null,
  stateAsOf: null,
  latestStatus: "passed",
  latestTemp: 34,
  tempThresholds: { warning: 45, error: 55 },
  latestPowerOnHours: 20_000,
  ageDays: 400,
  warrantyDaysLeft: 500,
  inventory: {},
  membership: { poolId: 3, poolName: "tank" },
  usage: { kind: "zfs", fsTypes: ["zfs_member"], mounts: [], system: false },
  purpose: null,
  purposeInferred: false,
  vendor: null,
  media: "hdd",
  rotationRate: 7200,
  interface: "sata",
  link: "sata",
  recordingTech: null,
  logicalBlockSize: 512,
  physicalBlockSize: 4096,
  hardware: null,
};

describe("InventoryCards", () => {
  it("shows its fixed field set, whatever the table columns", async () => {
    const cards = await mountSuspended(InventoryCards, {
      props: { disks: [disk] },
    });
    const labels = cards.findAll("dt").map((dt) => dt.text());

    expect(labels).toEqual([
      "Capacity",
      "Host",
      "Pool",
      "Temp",
      "Power-on",
      "Warranty",
      "Media",
      "Interface",
      "Recording",
      "Usage",
    ]);
    expect(
      cards.get('[data-testid="inventory-card-recording"] dd').text(),
    ).toBe("—");
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
