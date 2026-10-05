// @vitest-environment nuxt
import { mountSuspended, registerEndpoint } from "@nuxt/test-utils/runtime";
import { flushPromises } from "@vue/test-utils";
import { describe, expect, it, vi } from "vitest";
import { defineComponent } from "vue";
import DiskPage from "./[id].vue";

const at = "2026-09-01T12:00:00.000Z";

const detail = {
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
  sectorFormat: "512e",
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
  keys: [{ kind: "wwn", value: "0x50014ee2b5c1d2e3" }],
  latestReadingAt: at,
  formFactor: "3.5 inches",
  counters: {
    reallocated: { value: 8, status: "accepted" },
    pending: { value: 16, status: "warning" },
    uncorrectable: { value: 18, status: "acknowledged" },
    wearPercent: null,
    bytesWritten: null,
    bytesWrittenInferred: false,
  },
  faultCounts: { error: 0, warning: 1, acknowledged: 1 },
  disposal: null,
  replacesDiskId: null,
  replacedByDiskId: null,
  present: true,
  modelShort: "Red",
  diaryCount: 1,
  seenSinceDisposal: null,
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
    poolArchived: false,
  },
};

registerEndpoint("/api/disks/7", () => detail);
registerEndpoint("/api/disks/17", () => ({
  ...detail,
  id: 17,
  latestFarm: {
    interface: "ata",
    logVersion: "4.19",
    powerOnHours: 60_000,
    workload: {},
    errors: {},
    environment: {},
    perHead: [],
  },
}));
registerEndpoint("/api/disks/8", () => ({
  ...detail,
  id: 8,
  alias: "K1",
  disposal: { kind: "rma", on: "2026-09-02" },
}));
registerEndpoint("/api/disks/9", () => ({
  ...detail,
  id: 9,
  alias: "H1",
  present: false,
  state: "removed",
  membership: null,
}));
registerEndpoint("/api/disks", () => []);

const diaryQueries: Record<string, string>[] = [];
registerEndpoint("/api/diary", (event) => {
  diaryQueries.push(
    Object.fromEntries(new URL(event.path, "http://x").searchParams),
  );
  return [
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
  ];
});

const smartQueries: string[] = [];

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

registerEndpoint("/api/disks/7/smart", (event) => {
  smartQueries.push(event.path);
  return smartOverview;
});

const smartOverview = {
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
        kind: "accept",
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
    {
      ...passedAttribute("198", "Offline Uncorrectable", null),
      transformedValue: 18,
      status: "failed",
      displayStatus: "acknowledged",
      acceptance: {
        id: 2,
        kind: "acknowledge",
        acceptedValue: 18,
        acceptedAt: "2026-09-21T09:00:00.000Z",
        note: "",
      },
    },
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
      kind: "accept",
      acceptedValue: 8,
      acceptedAt: "2026-09-20T09:00:00.000Z",
      note: "Stable since RMA refused",
      supersededAt: null,
      clearedAt: null,
    },
  ],
};

// UTooltip needs the provider UApp installs in app.vue; the page is mounted alone.
const TooltipPassthrough = defineComponent({
  setup:
    (_, { slots }) =>
    () =>
      slots.default?.(),
});

const mountPage = async (route: string) => {
  const page = await mountSuspended(DiskPage, {
    route,
    global: { stubs: { UTooltip: TooltipPassthrough } },
  });
  await flushPromises();
  return page;
};

describe("disk page", () => {
  it("shows the header strip and Overview without loading SMART or the diary", async () => {
    smartQueries.length = 0;
    diaryQueries.length = 0;
    const page = await mountPage("/disks/7");
    const text = page.text();

    expect(text).toContain("K2");
    expect(text).toMatch(/WD80EFAX\s+· VK0ABC/);
    expect(text).not.toContain("WDC WD80EFAX");

    const strip = page.get('[data-testid="status-strip"]');
    expect(strip.text()).toContain("SMART warning");
    expect(strip.get("span[data-state]").attributes("data-state")).toBe(
      "in-use",
    );
    expect(strip.find('[data-testid="disk-usage"]').exists()).toBe(false);
    expect(strip.get('[data-testid="pool-breadcrumb"]').text()).toContain(
      "raidz2-0",
    );
    const vdevTypeIcon = strip.get("[data-vdev-type]");
    expect(vdevTypeIcon.attributes("data-vdev-type")).toBe("raidz2");
    expect(vdevTypeIcon.html()).toContain("i-lucide:layers");
    const membershipState = strip.get('[data-testid="membership-state"]');
    expect(membershipState.text()).toBe("ONLINE");
    expect(membershipState.classes()).toContain("text-success");
    expect(strip.text()).toContain("K2-part1");
    expect(strip.get('a[href="/zfs/3"]').text()).toBe("tank");
    expect(
      strip.get('[data-testid="disk-fault-badges"]').attributes("href"),
    ).toBe("/faults?subject=disk:7");

    expect(page.find('[data-testid="smart-tab-status"]').exists()).toBe(true);
    expect(page.get('[data-testid="diary-tab-count"]').text()).toBe("1");

    expect(text).toMatch(/SATA 3\.1 via SAS\s+· 6\.0 Gb\/s/);
    expect(text).toContain("512e");
    expect(text).toContain("WD Red");
    expect(text).toContain("0.9 % · 4,321 drives · Backblaze thru Q2 2026");
    expect(text).toContain("Specs: nasdisks.com (CC BY 4.0)");
    expect(text).toContain("8.00 TB");
    expect(text).toContain("5.7 y old");
    expect(text).toContain("0x50014ee2b5c1d2e3");

    expect(page.find('[data-testid="attribute-table"]').exists()).toBe(false);
    expect(smartQueries).toEqual([]);
    expect(diaryQueries).toEqual([]);
  });

  it("opens the Diary tab from the query string and loads it then", async () => {
    diaryQueries.length = 0;
    const page = await mountPage("/disks/7?tab=diary");

    await vi.waitFor(() =>
      expect(page.text()).toContain("warning (was passed)"),
    );
    expect(diaryQueries.at(-1)).toMatchObject({
      subjectType: "disk",
      subjectId: "7",
      limit: "20",
    });
  });

  it("disables the lifecycle menu while disposed", async () => {
    const page = await mountPage("/disks/8");

    expect(page.find('[data-testid="disk-disposal-banner"]').exists()).toBe(
      true,
    );
    expect(
      page.get('[aria-label="State override"]').attributes("disabled"),
    ).toBeDefined();
  });

  it("offers Dispose in the toolbar only for a disk that is not present", async () => {
    const present = await mountPage("/disks/7");
    expect(present.find('[data-testid="dispose-prominent"]').exists()).toBe(
      false,
    );

    const absent = await mountPage("/disks/9");
    expect(absent.find('[data-testid="dispose-prominent"]').exists()).toBe(
      true,
    );

    const disposed = await mountPage("/disks/8");
    expect(disposed.find('[data-testid="dispose-prominent"]').exists()).toBe(
      false,
    );
  });

  it("offers a FARM tab only for disks with a FARM log", async () => {
    const tabLabels = async (route: string) =>
      (await mountPage(route))
        .findAll('[role="tab"]')
        .map((tab) => tab.text().trim());
    expect(await tabLabels("/disks/7")).toEqual([
      "Overview",
      "SMART",
      "Statistics",
      expect.stringMatching(/^Diary/),
    ]);
    expect(await tabLabels("/disks/17")).toContain("FARM");
  });

  it("shows FARM hours on the power-on figure when SMART was reset", async () => {
    const page = await mountPage("/disks/17");
    const figure = page.get('[data-figure="power-on"]');
    expect(figure.text()).toContain("FARM 6.8 y");
    expect(figure.get("a").classes()).toContain("text-warning");
  });

  it("shows headline figures above the tabs and groups as panels, Health first", async () => {
    const page = await mountPage("/disks/7");
    const figures = page.get('[data-testid="headline-figures"]');
    expect(
      figures
        .findAll("[data-figure]")
        .map((figure) => figure.attributes("data-figure")),
    ).toEqual(["capacity", "temperature", "power-on", "age"]);
    expect(figures.get('[data-figure="temperature"]').text()).toContain(
      "34 °C",
    );

    const groups = page
      .get('[data-testid="disk-overview"]')
      .findAll("section h2")
      .map((heading) => heading.text());
    expect(groups).toEqual([
      "Health",
      "Placement",
      "Identity",
      "Hardware",
      "Ownership",
      "Notes",
    ]);
  });

  it("opens the SMART tab with attributes failing first", async () => {
    const page = await mountPage("/disks/7?tab=smart");
    await vi.waitFor(() =>
      expect(page.find('[data-testid="attribute-table"]').exists()).toBe(true),
    );
    const text = page.text();

    expect(text).toContain("1 warning, 1 acknowledged attributes");
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
    expect(rows[0]).toContain("Acknowledge");
    expect(rows[0]).not.toMatch(/Accept|Clear/);
    expect(rows[1]).toContain("Offline Uncorrectable");
    expect(rows[1]).toMatch(/^ack\d/);
    expect(rows[1]).toContain("ack at 18");
    expect(rows[1]).not.toContain("acknowledged");
    expect(rows[1]).not.toContain("Acknowledge");
    expect(rows[1]).toContain("Accept");
    expect(rows[1]).toContain("Clear");
    expect(rows[2]).toContain("accepted");
    expect(rows[2]).not.toContain("Accept");
    expect(rows[2]).toContain("Clear");
    expect(rows[3]).toContain("34 °C");
    expect(rows[3]).not.toContain("Accept");

    const statusDots = attributeRows().map((row) => {
      const dot = row.find('[data-testid="attribute-status"] [data-shape]');
      return dot.exists()
        ? `${dot.attributes("data-colour")} ${dot.attributes("data-shape")}`
        : null;
    });
    expect(statusDots).toEqual([
      "warning filled",
      "warning filled",
      "warning hollow",
      null,
    ]);
    const acknowledgedValue = attributeRows()[1]?.get(
      '[data-testid="accepted-value"]',
    );
    expect(acknowledgedValue?.html()).toContain("i-lucide:eye");
    const acceptedValue = attributeRows()[2]?.get(
      '[data-testid="accepted-value"]',
    );
    expect(acceptedValue?.text()).toBe("accepted at 8");
    expect(acceptedValue?.html()).toContain("i-lucide:shield-check");

    expect(page.get('[data-testid="attribute-visibility"]').text()).toBe(
      "4 shown, 2 less useful hidden",
    );
    const notedRows = attributeRows().map((row) =>
      row.find('[data-testid="attribute-note"]').exists(),
    );
    expect(notedRows).toEqual([true, false, true, true]);

    expect(page.find('[data-testid="attribute-detail"]').exists()).toBe(false);
    await attributeRows()[0]?.trigger("click");
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
