// @vitest-environment nuxt
import { mountSuspended, registerEndpoint } from "@nuxt/test-utils/runtime";
import { describe, expect, it } from "vitest";
import { defineComponent } from "vue";
import DiskPage from "./[id].vue";

const at = "2026-09-01T12:00:00.000Z";

registerEndpoint("/api/disks/7", () => ({
  id: 7,
  alias: "K2",
  model: "WDC WD80EFAX",
  serial: "VK0ABC",
  firmware: "83.H0A83",
  capacityBytes: 8_001_563_222_016,
  protocol: "ata",
  transport: "sata",
  lastDevicePath: "/dev/sdb",
  firstSeenAt: at,
  lastSeenAt: at,
  hostName: "mars",
  latestStatus: "warning",
  latestTemp: 34,
  latestPowerOnHours: 40_000,
  latestPowerCycles: 120,
  state: "in-use",
  inferredState: "in-use",
  stateOverride: null,
  notes: "",
  inventory: { purchaseDate: "2020-01-01" },
  ageDays: 2100,
  warrantyDaysLeft: null,
  keys: [],
  membership: {
    poolId: 3,
    poolName: "tank",
    vdevName: "/dev/disk/by-vdev/K2-part1",
    groupName: "raidz2-0",
    groupType: "raidz2",
    vdevState: "ONLINE",
  },
  diary: [
    {
      id: 1,
      subjectType: "disk",
      subjectId: 7,
      at,
      kind: "auto",
      eventType: "smart-status-changed",
      title: "warning (was passed)",
      body: "",
      data: {},
    },
  ],
}));

registerEndpoint("/api/disks/7/smart", () => ({
  reading: {
    id: 1,
    takenAt: at,
    devicePath: "/dev/sdb",
    deviceStatus: "warning",
  },
  attributes: [
    {
      attrId: "194",
      name: "Temperature",
      value: 100,
      worst: 100,
      thresh: 0,
      transformedValue: 34,
      status: "passed",
      displayStatus: "passed",
      acceptance: null,
      failureRate: null,
      reason: null,
      rawString: "34",
      trend: "stable",
      metadata: {
        displayName: "Temperature",
        ideal: "low",
        critical: false,
        description: "Current internal temperature.",
        transformValueUnit: "°C",
      },
    },
    {
      attrId: "197",
      name: "Current Pending Sector Count",
      value: 200,
      worst: 200,
      thresh: 0,
      transformedValue: 16,
      status: "warning",
      displayStatus: "warning",
      acceptance: null,
      failureRate: 0.12,
      reason: "16 pending sectors",
      rawString: "16",
      trend: "worsening",
      metadata: {
        displayName: "Current Pending Sector Count",
        ideal: "low",
        critical: true,
        description: "Sectors waiting to be remapped.",
      },
    },
    {
      attrId: "5",
      name: "Reallocated Sector Count",
      value: 100,
      worst: 100,
      thresh: 10,
      transformedValue: 8,
      status: "failed",
      displayStatus: "accepted",
      acceptance: {
        id: 1,
        acceptedValue: 8,
        acceptedAt: "2026-09-20T09:00:00.000Z",
        note: "Stable since RMA refused",
      },
      failureRate: 0.2,
      reason: "8 reallocated sectors",
      rawString: "8",
      trend: "stable",
      metadata: null,
    },
  ],
  history: { temperature: [], attributes: {} },
  selfTests: [
    {
      id: 1,
      diskId: 7,
      type: "Extended offline",
      status: "Completed: read failure",
      passed: false,
      lifetimeHours: 39_990,
      lba: 123456,
      seenAt: at,
    },
  ],
  acceptances: [],
}));

// UTooltip needs the provider UApp installs in app.vue; the page is mounted alone.
const TooltipPassthrough = defineComponent({
  setup:
    (_, { slots }) =>
    () =>
      slots.default?.(),
});

describe("disk page", () => {
  it("shows the nameplate, attributes with failing first, membership and diary", async () => {
    const page = await mountSuspended(DiskPage, {
      route: "/disks/7",
      global: { stubs: { UTooltip: TooltipPassthrough } },
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    const text = page.text();

    expect(text).toContain("K2");
    expect(text).toContain("VK0ABC");
    expect(text).toContain("8.00 TB");
    expect(text).toContain("5.7 y old");
    expect(text).toContain("1 warning attribute");
    expect(text).toContain("· 1 accepted");

    const rows = page.findAll("tbody tr").map((row) => row.text());
    expect(rows[0]).toContain("Current Pending Sector Count");
    expect(rows[0]).toContain("12.0 %");
    expect(rows[0]).toContain("Accept");
    expect(rows[1]).toContain("accepted");
    expect(rows[1]).toContain("Clear");
    expect(rows[2]).toContain("34 °C");
    expect(rows[2]).not.toContain("Accept");

    const selfTests = page.get('[data-testid="self-tests"]');
    expect(selfTests.text()).toContain("Extended offline");
    expect(selfTests.text()).toContain("39,990 h");
    expect(selfTests.text()).toContain("123456");

    expect(text).toContain("raidz2-0");
    expect(text).toContain("K2-part1");
    expect(page.find('a[href="/zfs/3"]').text()).toBe("tank");
    expect(text).toContain("warning (was passed)");
  });
});
