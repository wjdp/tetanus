// @vitest-environment nuxt
import { mountSuspended, registerEndpoint } from "@nuxt/test-utils/runtime";
import type { VueWrapper } from "@vue/test-utils";
import { beforeEach, describe, expect, it } from "vitest";
import { clearNuxtData } from "#app";
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
  latestPowerOnHours: 20_000,
  ageDays: 400,
  warrantyDaysLeft: 500,
  inventory: {},
  keys: [],
  membership: null,
  usage: { kind: "empty", fsTypes: [], mounts: [], system: false },
  purpose: null,
  purposeInferred: false,
  ...overrides,
});

let disks: unknown[] = [];
registerEndpoint("/api/disks", () => disks);

beforeEach(() => {
  clearNuxtData();
});

const aliasColumn = (page: VueWrapper) =>
  page.findAll("tbody tr").map((row) => row.find("td").text());

describe("disks inventory page", () => {
  it("points at Settings › Hosts when there are no disks", async () => {
    disks = [];
    const page = await mountSuspended(DisksPage);
    expect(page.text()).toContain("No disks yet.");
    expect(page.find('a[href="/settings/hosts"]').exists()).toBe(true);
  });

  it("sorts by alias naturally with unaliased disks last", async () => {
    disks = [
      disk({ id: 1, alias: null, serial: "NOALIAS" }),
      disk({ id: 2, alias: "K10" }),
      disk({ id: 3, alias: "K2", stateOverride: "spare", state: "spare" }),
    ];
    const page = await mountSuspended(DisksPage);

    expect(aliasColumn(page)).toEqual(["K2", "K10", "—"]);
    expect(page.get('[data-testid="disk-count"]').text()).toBe("· 3");
    expect(page.text()).toContain("override");
  });

  it("filters by text search and updates the count", async () => {
    disks = [
      disk({ id: 1, alias: "K1", serial: "AAA111" }),
      disk({ id: 2, alias: "K2", serial: "BBB222" }),
    ];
    const page = await mountSuspended(DisksPage);
    await page.get('input[aria-label="Search disks"]').setValue("bbb");

    expect(aliasColumn(page)).toEqual(["K2"]);
    expect(page.get('[data-testid="disk-count"]').text()).toBe("· 1 of 2");
  });

  it("flags warranties ending within 90 days", async () => {
    disks = [
      disk({ id: 1, alias: "K1", warrantyDaysLeft: 30 }),
      disk({ id: 2, alias: "K2", warrantyDaysLeft: -10 }),
    ];
    const page = await mountSuspended(DisksPage);

    expect(page.get('[data-warranty-days="30"]').classes()).toContain(
      "text-warning",
    );
    const expired = page.get('[data-warranty-days="-10"]');
    expect(expired.text()).toBe("expired");
    expect(expired.classes()).not.toContain("text-error");
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
    const page = await mountSuspended(DisksPage);

    expect(page.findAll('a[href="/zfs/3"]').map((link) => link.text())).toEqual(
      ["tank", "tank"],
    );
    expect(page.findAll("tbody tr")[2].text()).toContain("—");
    expect(page.find('[aria-label="Filter by pool"]').exists()).toBe(true);
  });
});
