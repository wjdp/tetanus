// @vitest-environment nuxt
import { mountSuspended, registerEndpoint } from "@nuxt/test-utils/runtime";
import type { VueWrapper } from "@vue/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { nextTick } from "vue";
import { clearNuxtData } from "#app";
import { NO_DISK_FAULTS } from "#shared/faults";
import { NO_COUNTERS } from "#shared/smart/counters";
import { CLEARED_FILTERS } from "~/components/inventory/filterDisks";
import InventoryColumnPicker from "~/components/inventory/InventoryColumnPicker.vue";
import InventoryFilters from "~/components/inventory/InventoryFilters.vue";
import { INVENTORY_PREFERENCES_COOKIE } from "~/composables/useInventoryPreferences";
import { clearCookie, writeCookie } from "~~/test/cookies";
import DisksPage from "./index.vue";

const disk = (overrides: Record<string, unknown>) => ({
  id: 1,
  alias: null,
  model: "ST4000VN008",
  serial: "ZC100001",
  capacityBytes: 4e12,
  hostName: "mars",
  state: "in-use",
  stateOverride: null,
  latestStatus: "passed",
  latestTemp: 34,
  tempThresholds: { warning: 45, error: 55 },
  latestPowerOnHours: 20_000,
  ageDays: 400,
  warrantyDaysLeft: 500,
  inventory: {},
  keys: [],
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
  counters: NO_COUNTERS,
  faultCounts: NO_DISK_FAULTS,
  disposal: null,
  replacesDiskId: null,
  replacedByDiskId: null,
  ...overrides,
});

let disks: unknown[] = [];
registerEndpoint("/api/disks", () => disks);

const storePreferences = (preferences: object) =>
  writeCookie(INVENTORY_PREFERENCES_COOKIE, JSON.stringify(preferences));

beforeEach(() => {
  clearNuxtData();
  clearCookie(INVENTORY_PREFERENCES_COOKIE);
});

const mountPage = (route = "/disks") => mountSuspended(DisksPage, { route });

const headers = (page: VueWrapper) =>
  page.findAll("thead th").map((th) => th.text());

const aliasColumn = (page: VueWrapper) =>
  page.findAll("tbody tr").map((row) => row.find("td").text());

describe("disks inventory page", () => {
  it("points at Settings › Hosts when there are no disks", async () => {
    disks = [];
    const page = await mountPage();
    expect(page.text()).toContain("No disks yet.");
    expect(page.find('a[href="/settings/hosts"]').exists()).toBe(true);
  });

  it("sorts by alias naturally with unaliased disks last", async () => {
    disks = [
      disk({ id: 1, alias: null, serial: "NOALIAS" }),
      disk({ id: 2, alias: "K10" }),
      disk({ id: 3, alias: "K2", stateOverride: "spare", state: "spare" }),
    ];
    const page = await mountPage();

    expect(aliasColumn(page)).toEqual(["K2", "K10", "—"]);
    expect(page.get('[data-testid="disk-count"]').text()).toBe("· 3");
    expect(page.get('[data-state="spare"]').attributes("title")).toBe(
      "set by hand",
    );
  });

  it("hides disposed disks unless the query includes them", async () => {
    disks = [
      disk({ id: 1, alias: "K1" }),
      disk({
        id: 2,
        alias: "K2",
        state: "removed",
        disposal: { kind: "rma", on: "2026-10-02" },
        replacedByDiskId: 3,
      }),
      disk({ id: 3, alias: "K7" }),
    ];

    const page = await mountPage();
    expect(aliasColumn(page)).toEqual(["K1", "K7"]);
    expect(page.get('[data-testid="disk-count"]').text()).toBe("· 2");

    const included = await mountPage("/disks?disposed=1");
    expect(aliasColumn(included)).toEqual(["K1", "K2", "K7"]);
    expect(included.get('[data-testid="disk-count"]').text()).toBe("· 3");
    const disposed = included.get('[data-disposal="rma"]');
    expect(disposed.text()).toBe("RMA · replaced by K7");
    expect(included.findAll("tbody tr")[1]?.classes()).toContain("opacity-60");
    expect(included.findAll("tbody tr")[0]?.classes()).not.toContain(
      "opacity-60",
    );
  });

  it("filters by text search and updates the count", async () => {
    disks = [
      disk({ id: 1, alias: "K1", serial: "AAA111" }),
      disk({ id: 2, alias: "K2", serial: "BBB222" }),
    ];
    const page = await mountPage();
    await page.get('input[aria-label="Search disks"]').setValue("bbb");

    expect(aliasColumn(page)).toEqual(["K2"]);
    expect(page.get('[data-testid="disk-count"]').text()).toBe("· 1 of 2");
  });

  it("flags warranties ending within 90 days", async () => {
    disks = [
      disk({ id: 1, alias: "K1", warrantyDaysLeft: 30 }),
      disk({ id: 2, alias: "K2", warrantyDaysLeft: -10 }),
    ];
    const page = await mountPage();

    expect(page.get('[data-warranty-days="30"]').classes()).toContain(
      "text-warning",
    );
    const expired = page.get('[data-warranty-days="-10"]');
    expect(expired.text()).toBe("expired");
    expect(expired.classes()).not.toContain("text-error");
  });

  it("renders SMART dots with shape and hot temperatures in colour", async () => {
    disks = [
      disk({ id: 1, alias: "K1", latestStatus: "unknown", latestTemp: 45 }),
    ];
    const page = await mountPage();
    const row = page.get("tbody tr");

    expect(row.get("[data-shape]").attributes("data-shape")).toBe("hollow");
    expect(row.get('[data-testid="inventory-temp"]').classes()).toContain(
      "text-warning",
    );
  });

  it("shows the pool and offers distinct pools to filter by", async () => {
    const tank = {
      poolId: 3,
      poolName: "tank",
      vdevName: "/dev/disk/by-vdev/K1-part1",
      groupName: "raidz1-0",
      groupType: "raidz1",
      vdevState: "ONLINE",
    };
    disks = [
      disk({ id: 1, alias: "K1", membership: tank }),
      disk({ id: 2, alias: "K2", membership: { ...tank, vdevName: "K2" } }),
      disk({ id: 3, alias: "K3" }),
    ];
    const page = await mountPage();

    expect(page.findAll('a[href="/zfs/3"]').map((link) => link.text())).toEqual(
      ["tank", "tank"],
    );
    expect(page.findAll("tbody tr")[2].text()).toContain("—");
    expect(page.find('[aria-label="Filter by pool"]').exists()).toBe(true);
  });

  describe("hardware columns and filters", { timeout: 15_000 }, () => {
    const sataHdd = {
      media: "hdd",
      rotationRate: 7200,
      interface: "sata",
      link: "sas",
      recordingTech: "smr",
      vendor: "western-digital",
      model: "WDC WD80EFAX",
      logicalBlockSize: 512,
      physicalBlockSize: 4096,
    };
    const nvmeSsd = {
      media: "ssd",
      rotationRate: 0,
      interface: "nvme",
      link: "nvme",
      recordingTech: null,
      vendor: "samsung",
      model: "Samsung SSD 990 PRO",
    };
    const rowTexts = (page: VueWrapper) =>
      page.findAll("tbody tr").map((row) => row.text());

    it("shows media, interface and recording, and the display model", async () => {
      storePreferences({ columns: { interface: true, recording: true } });
      disks = [
        disk({
          id: 1,
          alias: "K1",
          ...sataHdd,
          membership: { poolId: 1, poolName: "tank" },
        }),
        disk({ id: 2, alias: "K2", ...nvmeSsd }),
      ];
      const page = await mountPage();
      const [hdd, ssd] = rowTexts(page);

      expect(hdd).toContain("HDD 7200");
      expect(hdd).toContain("SATA via SAS");
      expect(hdd).toContain("SMR");
      expect(hdd).toContain("WD");
      expect(hdd).toContain("WD80EFAX");
      expect(hdd).not.toContain("WDC");
      expect(ssd).toContain("SSD");
      expect(ssd).toContain("NVMe");
      expect(ssd).toContain("990 PRO");
      expect(page.find('tbody tr [data-media="hdd"]').exists()).toBe(true);
      expect(page.find('tbody tr [data-media="ssd"]').exists()).toBe(true);
    });

    it("hides the sector column by default", async () => {
      disks = [disk({ id: 1, alias: "K1", ...sataHdd })];
      const page = await mountPage();

      expect(headers(page)).not.toContain("Sectors");
      expect(page.find("tbody").text()).not.toContain("512e");
    });

    it("shows and hides columns from the column picker", async () => {
      disks = [disk({ id: 1, alias: "K1", ...sataHdd })];
      const page = await mountPage();
      const picker = page.getComponent(InventoryColumnPicker);
      const cardLabels = () => page.findAll("dt").map((dt) => dt.text());
      const cardsBefore = cardLabels();

      picker.vm.$emit("toggle", "sectors", true);
      picker.vm.$emit("toggle", "host", false);
      await nextTick();
      expect(headers(page)).toContain("Sectors");
      expect(headers(page)).not.toContain("Host");
      expect(page.find("tbody").text()).toContain("512e");
      expect(cardLabels()).toEqual(cardsBefore);

      picker.vm.$emit("reset");
      await nextTick();
      expect(headers(page)).not.toContain("Sectors");
      expect(headers(page)).toContain("Host");
    });

    it("filters by media, interface, recording and vendor", async () => {
      disks = [
        disk({ id: 1, alias: "K1", ...sataHdd }),
        disk({ id: 2, alias: "K2", ...nvmeSsd }),
        disk({ id: 3, alias: "K3" }),
      ];
      const page = await mountPage();
      const filter = async (label: string, value: string) => {
        const key = label.replace("Filter by ", "");
        await page
          .getComponent(InventoryFilters)
          .vm.$emit("update:modelValue", { ...CLEARED_FILTERS, [key]: value });
      };

      const shows = (expected: string[]) =>
        vi.waitFor(() => expect(aliasColumn(page)).toEqual(expected));

      await filter("Filter by media", "ssd");
      await shows(["K2"]);

      await filter("Filter by interface", "sata");
      await shows(["K1"]);
      await filter("Filter by interface", "-");
      await shows(["K3"]);

      await filter("Filter by recording", "smr");
      await shows(["K1"]);

      await filter("Filter by vendor", "samsung");
      await shows(["K2"]);
      await filter("Filter by vendor", "-");
      await shows(["K3"]);
    });
  });

  it("filters by SMART status and writes it to the query string", async () => {
    disks = [
      disk({ id: 1, alias: "K1", latestStatus: "passed" }),
      disk({ id: 2, alias: "K2", latestStatus: "failed" }),
      disk({ id: 3, alias: "K3", latestStatus: "warning" }),
    ];
    const page = await mountPage();

    await page.getComponent(InventoryFilters).vm.$emit("update:modelValue", {
      ...CLEARED_FILTERS,
      statuses: ["failed", "warning"],
    });

    await vi.waitFor(() => expect(aliasColumn(page)).toEqual(["K2", "K3"]));
    expect(useRouter().currentRoute.value.query).toEqual({
      status: "failed,warning",
    });
    expect(page.get('[data-testid="disk-count"]').text()).toBe("· 2 of 3");
  });

  it("pre-filters and sorts from the query string on load", async () => {
    disks = [
      disk({ id: 1, alias: "K1", hostName: "mars", latestTemp: 30 }),
      disk({ id: 2, alias: "K2", hostName: "venus", latestTemp: 40 }),
      disk({ id: 3, alias: "K3", hostName: "mars", latestTemp: 50 }),
      disk({ id: 4, alias: "K4", hostName: "mars", latestStatus: "failed" }),
    ];
    const page = await mountPage(
      "/disks?host=mars&status=passed&sort=-temp&q=k",
    );

    expect(aliasColumn(page)).toEqual(["K3", "K1"]);
    expect(page.get('[data-testid="disk-count"]').text()).toBe("· 2 of 4");
    expect(
      page.get<HTMLInputElement>('input[aria-label="Search disks"]').element
        .value,
    ).toBe("k");
  });

  it("swaps the table for cards from the view toggle", async () => {
    disks = [disk({ id: 1, alias: "K1" })];
    const page = await mountPage();
    const cards = () => page.get('[data-testid="inventory-cards"]');

    expect(page.find('[data-testid="inventory-table"]').exists()).toBe(true);
    expect(cards().classes()).toContain("md:hidden");

    await page.get('[data-testid="view-cards"]').trigger("click");
    expect(page.find('[data-testid="inventory-table"]').exists()).toBe(false);
    expect(cards().classes()).not.toContain("md:hidden");
    expect(page.findComponent(InventoryColumnPicker).exists()).toBe(false);

    await page.get('[data-testid="view-table"]').trigger("click");
    expect(page.find('[data-testid="inventory-table"]').exists()).toBe(true);
  });

  it("renders the stored view on first load", async () => {
    storePreferences({ view: "cards" });
    disks = [disk({ id: 1, alias: "K1" })];
    const page = await mountPage();

    expect(page.find('[data-testid="inventory-table"]').exists()).toBe(false);
  });
});
