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
  link: "sas",
  vendor: "western-digital",
  media: "hdd",
  interface: "sata",
  recordingTech: "cmr",
  rotationRate: 5400,
  logicalBlockSize: 512,
  physicalBlockSize: 4096,
  trimSupported: false,
  hardware: {
    sataVersion: "SATA 3.1",
    ataVersion: "ACS-3 T13/2161-D revision 5",
    deviceType: "sat",
    linkSpeed: { maxBps: 6_000_000_000, currentBps: 6_000_000_000 },
  },
  specs: {
    source: "nasdisks",
    snapshot: "2026-09-04",
    matchedModel: "WD80EFAX",
    model: "WD80EFAX",
    brand: "WD",
    line: "Red",
    capacityTb: 8,
    rpm: 5400,
    cacheMb: 256,
    interface: "SATA",
    formFactor: "3.5",
    recordingTech: "cmr",
    ercTler: true,
    isHelium: false,
    driveClass: "NAS",
    mediaType: "hdd",
    inProduction: false,
    alsoSoldAs: [],
    nandType: null,
    tbwTb: null,
    dwpd: null,
    hasDram: null,
    hasPlp: null,
    sustainedWriteMbps: null,
    afrPct: 0.9,
    reliabilityDriveCount: 4321,
    reliabilitySource: "Backblaze thru Q2 2026",
  },
  lastDevicePath: "/dev/sdb",
  firstSeenAt: at,
  lastSeenAt: at,
  hostName: "mars",
  latestStatus: "warning",
  latestTemp: 34,
  tempThresholds: { warning: 45, error: 55 },
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
  usage: { kind: "zfs", fsTypes: ["zfs_member"], mounts: [], system: false },
  purpose: null,
  purposeInferred: false,
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

function passedAttribute(
  attrId: string,
  name: string,
  failureRate: number | null,
) {
  return {
    attrId,
    name,
    value: 100,
    worst: 100,
    thresh: 0,
    transformedValue: 0,
    status: "passed",
    displayStatus: "passed",
    acceptance: null,
    failureRate,
    reason: null,
    rawString: "0",
    trend: "stable",
    statusChanges: [],
    statusSince: null,
    valueSince: at,
    firstNonZeroAt: null,
    metadata: null,
  };
}

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
      failureRate: 0.15,
      reason: null,
      rawString: "34",
      trend: "stable",
      statusChanges: [],
      statusSince: null,
      valueSince: "2026-08-30T12:00:00.000Z",
      firstNonZeroAt: "2026-01-01T00:00:00.000Z",
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
      statusChanges: [
        {
          at: "2026-08-28T06:00:00.000Z",
          from: "passed",
          to: "warning",
          value: 1,
        },
      ],
      statusSince: "2026-08-28T06:00:00.000Z",
      valueSince: "2026-08-31T12:00:00.000Z",
      firstNonZeroAt: "2026-08-28T06:00:00.000Z",
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
      statusChanges: [],
      statusSince: null,
      valueSince: "2026-09-01T12:00:00.000Z",
      firstNonZeroAt: "2026-09-01T12:00:00.000Z",
      metadata: null,
    },
    passedAttribute("9", "Power-On Hours", 0.02),
    passedAttribute("198", "Offline Uncorrectable", null),
    passedAttribute("1", "Raw Read Error Rate", null),
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
  acceptances: [
    {
      id: 1,
      diskId: 7,
      attrId: "5",
      acceptedValue: 8,
      acceptedAt: "2026-09-20T09:00:00.000Z",
      note: "Stable since RMA refused",
      supersededAt: null,
      clearedAt: null,
    },
  ],
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
    const diagnostics = page.get('a[href="/api/disks/7/diagnostics"]');
    expect(diagnostics.text()).toBe("Download diagnostics");
    expect(diagnostics.attributes()).toHaveProperty("download");
    expect(text).toMatch(/WD80EFAX\s+· VK0ABC/);
    expect(text).not.toContain("WDC WD80EFAX");
    expect(text).toMatch(/SATA 3\.1 via SAS\s+· 6\.0 Gb\/s/);
    expect(text).toContain("HDD · 5400 rpm · CMR");
    expect(text).toContain("512e");
    expect(text).not.toContain("Protocol");
    expect(text).toContain("WD Red");
    expect(text).toContain("0.9 % · 4,321 drives · Backblaze thru Q2 2026");
    expect(text).toContain("Specs: nasdisks.com (CC BY 4.0)");
    expect(text).toContain("VK0ABC");
    expect(text).toContain("8.00 TB");
    expect(text).toContain("5.7 y old");
    expect(text).toContain("1 warning attribute");
    expect(text).toContain("· 1 accepted");

    const attributeRows = () =>
      page
        .findAll('[data-testid="attribute-table"] tbody tr')
        .filter(
          (row) => !row.find('[data-testid="attribute-detail"]').exists(),
        );
    const rows = attributeRows().map((row) => row.text());
    expect(rows).toHaveLength(4);
    expect(rows[0]).toContain("Current Pending Sector Count");
    expect(rows[0]).toContain("12.0 %");
    expect(rows[0]).toContain("Accept");
    expect(rows[1]).toContain("accepted");
    expect(rows[1]).toContain("Clear");
    expect(rows[2]).toContain("Offline Uncorrectable");
    expect(rows[3]).toContain("34 °C");
    expect(rows[3]).not.toContain("Accept");

    expect(page.get('[data-testid="attribute-visibility"]').text()).toBe(
      "4 shown, 2 less useful hidden",
    );
    const notedRows = attributeRows().map((row) =>
      row.find('[data-testid="attribute-note"]').exists(),
    );
    expect(notedRows).toEqual([true, true, false, true]);

    const details = page.findAll('[data-testid="attribute-detail"]');
    expect(details).toHaveLength(1);
    const detail = details[0]?.text() ?? "";
    expect(detail).toContain("warning since 2026-08-28");
    expect(detail).toContain("2026-08-28 · warning (was passed, value 1)");
    expect(detail).toContain("16 since 2026-08-31 · first non-zero 2026-08-28");
    expect(detail).toContain("No history in this range");
    expect(detail).toContain("norm 200 / worst 200 / thresh 0 · raw 16");

    const contextRates = page.findAll('[data-testid="context-rate"]');
    expect(contextRates).toHaveLength(1);
    expect(contextRates[0]?.text()).toBe("15.0 %");
    expect(contextRates[0]?.classes()).toContain("text-info");

    const selfTests = page.get('[data-testid="self-tests"]');
    expect(selfTests.text()).toContain("Extended offline");
    expect(selfTests.text()).toContain("39,990 h");
    expect(selfTests.text()).toContain("123456");

    expect(text).toContain("raidz2-0");
    expect(text).toContain("K2-part1");
    expect(page.find('a[href="/zfs/3"]').text()).toBe("tank");
    expect(text).toContain("warning (was passed)");

    const toggle = page.get('[data-testid="attribute-visibility-toggle"]');
    expect(toggle.text()).toBe("Show 2 less useful attributes");
    await toggle.trigger("click");
    const allRows = attributeRows().map((row) => row.text());
    expect(allRows).toHaveLength(6);
    expect(allRows[4]).toContain("Raw Read Error Rate");
    expect(allRows[5]).toContain("Power-On Hours");
    expect(page.get('[data-testid="attribute-visibility"]').text()).toBe(
      "6 shown",
    );
    expect(toggle.text()).toBe("Hide less useful attributes");
  });
});
