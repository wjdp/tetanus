// @vitest-environment nuxt
import { mountSuspended } from "@nuxt/test-utils/runtime";
import { describe, expect, it } from "vitest";
import InventoryTable from "./InventoryTable.vue";
import type { InventoryDisk } from "./types";

const disk = (overrides: Partial<InventoryDisk>): InventoryDisk => ({
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
  membership: null,
  usage: { kind: "empty", fsTypes: [], mounts: [], system: false },
  purpose: null,
  purposeInferred: false,
  vendor: null,
  media: null,
  rotationRate: null,
  interface: null,
  link: null,
  recordingTech: null,
  logicalBlockSize: null,
  physicalBlockSize: null,
  hardware: null,
  ...overrides,
});

const mountTable = (disks: InventoryDisk[]) =>
  mountSuspended(InventoryTable, { props: { disks } });

describe("InventoryTable", () => {
  it("draws the media glyph for hdd and ssd, nothing for unknown", async () => {
    const table = await mountTable([
      disk({ id: 1, alias: "K1", media: "hdd", rotationRate: 7200 }),
      disk({ id: 2, alias: "K2", media: "ssd" }),
      disk({ id: 3, alias: "K3", media: "unknown" }),
    ]);
    const rows = table.findAll("tbody tr");

    expect(rows[0].find('[data-media="hdd"]').exists()).toBe(true);
    expect(rows[1].find('[data-media="ssd"]').exists()).toBe(true);
    expect(rows[2].find("[data-media]").exists()).toBe(false);
  });

  it("shows the lifecycle badge, outlined when set by hand", async () => {
    const table = await mountTable([
      disk({ id: 1, alias: "K1", state: "in-use" }),
      disk({ id: 2, alias: "K2", state: "dead", stateOverride: "dead" }),
    ]);
    const [inferred, overridden] = table.findAll("[data-state]");

    expect(inferred.attributes("data-state")).toBe("in-use");
    expect(inferred.attributes("title")).toBeUndefined();
    expect(overridden.attributes("data-state")).toBe("dead");
    expect(overridden.attributes("title")).toBe("set by hand");
    expect(overridden.text()).toContain("Dead");
  });

  it("draws unknown SMART status as a hollow dot", async () => {
    const table = await mountTable([
      disk({ id: 1, alias: "K1", latestStatus: "passed" }),
      disk({ id: 2, alias: "K2", latestStatus: "unknown" }),
    ]);
    const dots = table.findAll("[data-shape]");

    expect(dots.map((dot) => dot.attributes("data-shape"))).toEqual([
      "filled",
      "hollow",
    ]);
    expect(dots[1].attributes("data-colour")).toBe("neutral");
  });

  it("colours the temperature from the disk's thresholds", async () => {
    const table = await mountTable([
      disk({ id: 1, alias: "K1", latestTemp: 44 }),
      disk({ id: 2, alias: "K2", latestTemp: 45 }),
      disk({ id: 3, alias: "K3", latestTemp: 55 }),
    ]);
    const temps = table.findAll('[data-testid="inventory-temp"]');

    expect(temps[0].classes()).toContain("text-dimmed");
    expect(temps[1].classes()).toContain("text-warning");
    expect(temps[2].classes()).toContain("text-error");
  });

  it("shows purpose as the vocabulary badge", async () => {
    const table = await mountTable([
      disk({ id: 1, alias: "K1", purpose: "system" }),
    ]);

    expect(table.get("tbody tr").text()).toContain("sys");
  });

  describe("empty cells", () => {
    const cellText = (
      table: Awaited<ReturnType<typeof mountTable>>,
      header: string,
      row = 0,
    ) => {
      const headers = table.findAll("thead th").map((th) => th.text());
      const index = headers.indexOf(header);
      expect(index).toBeGreaterThanOrEqual(0);
      return table.findAll("tbody tr")[row].findAll("td")[index].text();
    };

    it("shows a dash, never 0, for a 3.3 V pin that is not taped", async () => {
      const table = await mountTable([
        disk({ id: 1, alias: "K1", inventory: { pin33Taped: false } }),
      ]);

      expect(cellText(table, "3.3 V")).toBe("—");
    });

    it("shows a dash for an unknown recording technology", async () => {
      const table = await mountTable([
        disk({ id: 1, alias: "K1", recordingTech: null }),
      ]);

      expect(cellText(table, "Recording")).toBe("—");
    });
  });
});
