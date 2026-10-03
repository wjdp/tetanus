// @vitest-environment nuxt
import { mountSuspended, registerEndpoint } from "@nuxt/test-utils/runtime";
import { flushPromises } from "@vue/test-utils";
import { beforeEach, describe, expect, it } from "vitest";
import { clearNuxtData } from "#app";
import { INVENTORY_COLUMNS } from "./columns";
import InventoryTable from "./InventoryTable.vue";
import { emptyInventoryDisk } from "./testFixtures";
import type { InventoryDisk } from "./types";

let settingsConfig: Record<string, unknown> = {};
registerEndpoint("/api/settings", () => ({
  enrolToken: "x",
  config: settingsConfig,
}));

beforeEach(() => {
  settingsConfig = {};
  clearNuxtData();
});

const disk = (overrides: Partial<InventoryDisk>): InventoryDisk =>
  emptyInventoryDisk({
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
    usage: { kind: "empty", fsTypes: [], mounts: [], system: false },
    ...overrides,
  });

const ALL_COLUMNS = new Set(INVENTORY_COLUMNS.map(({ id }) => id));

const mountTable = (
  disks: InventoryDisk[],
  visibleColumns: ReadonlySet<string> = ALL_COLUMNS,
) => mountSuspended(InventoryTable, { props: { disks, visibleColumns } });

const headers = (table: Awaited<ReturnType<typeof mountTable>>) =>
  table.findAll("thead th").map((th) => th.text());

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

  describe("column visibility", () => {
    it("renders only the visible columns, in registry order", async () => {
      const table = await mountTable(
        [disk({ id: 1 })],
        new Set(["alias", "temp", "capacity"]),
      );

      expect(headers(table)).toEqual(["Alias", "Capacity", "Temp"]);
      expect(table.findAll("tbody tr td")).toHaveLength(3);
    });

    it("always shows the locked alias column", async () => {
      const table = await mountTable([disk({ id: 1 })], new Set(["temp"]));

      expect(headers(table)).toEqual(["Alias", "Temp"]);
    });

    it("shows the default columns when none are given", async () => {
      const table = await mountSuspended(InventoryTable, {
        props: { disks: [disk({ id: 1 })] },
      });

      expect(headers(table)).toContain("Warranty");
      expect(headers(table)).not.toContain("Sectors");
    });
  });

  describe("detail columns", () => {
    it("drops the serial line from Model when the Serial column shows", async () => {
      const withoutSerial = await mountTable(
        [disk({ id: 1 })],
        new Set(["model"]),
      );
      const withSerial = await mountTable(
        [disk({ id: 1 })],
        new Set(["model", "serial"]),
      );

      expect(withoutSerial.get("tbody tr").text()).toContain("ZC100001");
      expect(withSerial.findAll("tbody td")[1].text()).toBe("ST4000VN008");
      expect(withSerial.findAll("tbody td")[2].text()).toBe("ZC100001");
    });

    it("labels and formats prices in the configured currency", async () => {
      settingsConfig = { currency: "EUR" };
      const table = await mountTable(
        [disk({ id: 1, inventory: { purchasePrice: 200 } })],
        new Set(["price", "pricePerTb"]),
      );
      await flushPromises();

      expect(headers(table)).toEqual(["Alias", "Price", "€/TB"]);
      expect(table.findAll("tbody td").map((td) => td.text())).toEqual([
        "K1",
        "€200.00",
        "€50.00",
      ]);
    });

    it("sorts faults by open errors first", async () => {
      const table = await mountSuspended(InventoryTable, {
        props: {
          disks: [
            disk({
              id: 1,
              alias: "K1",
              faultCounts: { error: 0, warning: 4, acknowledged: 0 },
            }),
            disk({ id: 2, alias: "K2" }),
            disk({
              id: 3,
              alias: "K3",
              faultCounts: { error: 1, warning: 0, acknowledged: 0 },
            }),
          ],
          visibleColumns: new Set(["faults"]),
          sorting: [{ id: "faults", desc: true }],
        },
      });

      expect(
        table.findAll("tbody tr").map((row) => row.findAll("td")[0].text()),
      ).toEqual(["K3", "K1", "K2"]);
    });
  });

  describe("empty cells", () => {
    const cellText = (
      table: Awaited<ReturnType<typeof mountTable>>,
      header: string,
      row = 0,
    ) => {
      const index = headers(table).indexOf(header);
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

    it("dims a dash in every column with no value", async () => {
      const table = await mountTable([
        disk({
          id: 1,
          alias: null,
          model: null,
          serial: null,
          capacityBytes: null,
          hostName: null,
          latestTemp: null,
          latestPowerOnHours: null,
          ageDays: null,
          warrantyDaysLeft: null,
        }),
      ]);
      const emptyHeaders = headers(table).filter(
        (header) => !["Usage", "State", "Status"].includes(header),
      );

      for (const header of emptyHeaders) {
        expect(cellText(table, header), header).toBe("—");
      }
      expect(
        table.findAll("tbody td .text-dimmed").length,
      ).toBeGreaterThanOrEqual(emptyHeaders.length);
    });
  });
});
