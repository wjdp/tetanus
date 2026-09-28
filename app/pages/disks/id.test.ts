// @vitest-environment nuxt
import { mountSuspended, registerEndpoint } from "@nuxt/test-utils/runtime";
import { describe, expect, it } from "vitest";
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
  ],
  history: { temperature: [], attributes: {} },
}));

registerEndpoint("/api/pools", () => [
  {
    id: 3,
    name: "tank",
    host: { id: 1, name: "mars", displayName: null },
    vdevs: {
      id: 10,
      name: "tank",
      type: "root",
      state: "ONLINE",
      disk: null,
      children: [
        {
          id: 11,
          name: "raidz2-0",
          type: "raidz",
          state: "ONLINE",
          disk: null,
          children: [
            {
              id: 12,
              name: "K2",
              type: "disk",
              state: "ONLINE",
              readErrors: 0,
              writeErrors: 0,
              checksumErrors: 2,
              disk: {
                id: 7,
                alias: "K2",
                state: "in-use",
                latestStatus: "warning",
              },
              children: [],
            },
          ],
        },
      ],
    },
  },
]);

describe("disk page", () => {
  it("shows the nameplate, attributes with failing first, membership and diary", async () => {
    const page = await mountSuspended(DiskPage, { route: "/disks/7" });
    await new Promise((resolve) => setTimeout(resolve, 0));
    const text = page.text();

    expect(text).toContain("K2");
    expect(text).toContain("VK0ABC");
    expect(text).toContain("8.00 TB");
    expect(text).toContain("5.7 y old");
    expect(text).toContain("1 warning attribute");

    const rows = page.findAll("tbody tr").map((row) => row.text());
    expect(rows[0]).toContain("Current Pending Sector Count");
    expect(rows[0]).toContain("12.0 %");
    expect(rows[1]).toContain("34 °C");

    expect(text).toContain("raidz2-0");
    expect(text).toContain("warning (was passed)");
  });
});
