// @vitest-environment nuxt
import { mountSuspended, registerEndpoint } from "@nuxt/test-utils/runtime";
import { beforeEach, describe, expect, it } from "vitest";
import { defineComponent } from "vue";
import { clearNuxtData } from "#app";
import IndexPage from "./index.vue";

// UTooltip needs the provider UApp installs in app.vue; the page is mounted alone.
const TooltipPassthrough = defineComponent({
  setup:
    (_, { slots }) =>
    () =>
      slots.default?.(),
});
const mountPage = () =>
  mountSuspended(IndexPage, {
    global: { stubs: { UTooltip: TooltipPassthrough } },
  });

// registerEndpoint's handler is re-read on every request, but a second call
// for the same URL does not replace the first within one test file, so every
// scenario shares one endpoint and switches on a mutable fixture instead.
let hosts: unknown[] = [];
let pools: unknown[] = [];
let disks: unknown[] = [];

registerEndpoint("/api/hosts", () => hosts);
registerEndpoint("/api/pools", () => pools);
registerEndpoint("/api/disks", () => disks);
registerEndpoint("/api/settings", () => ({
  enrolToken: "ab".repeat(32),
  config: { missingAfterDays: 7 },
}));

const mars = {
  id: 1,
  name: "mars",
  displayName: null,
  toolVersions: {},
  healthchecksUrl: null,
  intermittent: false,
  position: 0,
  notes: "",
  firstSeenAt: new Date().toISOString(),
  lastSeenAt: new Date().toISOString(),
  lastRuns: {
    "zpool-status": { receivedAt: new Date().toISOString(), ok: true },
  },
};

function leaf(alias: string, id: number, overrides: object = {}) {
  return {
    id: 100 + id,
    guid: `leaf-${id}`,
    parentId: 11,
    name: `/dev/disk/by-vdev/${alias}-part1`,
    type: "disk",
    state: "ONLINE",
    readErrors: 0,
    writeErrors: 0,
    checksumErrors: 0,
    slowIos: 0,
    path: `/dev/disk/by-vdev/${alias}-part1`,
    sizeBytes: null,
    allocBytes: null,
    disk: {
      id,
      alias,
      state: "in-use",
      latestStatus: "passed",
      capacityBytes: 12e12,
      media: "hdd",
      purpose: null,
      latestTemp: 36,
      modelShort: "Ultrastar HC520",
      tempThresholds: { warning: 45, error: 55 },
    },
    children: [],
    ...overrides,
  };
}

const tank = {
  id: 7,
  name: "tank",
  state: "ONLINE",
  displayState: "ONLINE",
  sizeBytes: 36e12,
  allocBytes: 18e12,
  cap: 50,
  frag: 3,
  scan: {
    function: "SCRUB",
    state: "SCANNING",
    startTime: Math.floor(Date.now() / 1000) - 3600,
    examined: 50,
    toExamine: 100,
    errors: 0,
  },
  host: { id: 1, name: "mars", displayName: null },
  vdevs: {
    id: 10,
    guid: "root",
    name: "tank",
    type: "root",
    state: "ONLINE",
    readErrors: 0,
    writeErrors: 0,
    checksumErrors: 0,
    slowIos: null,
    path: null,
    sizeBytes: 36e12,
    allocBytes: 18e12,
    disk: null,
    children: [
      {
        id: 11,
        guid: "raidz",
        name: "raidz1-0",
        type: "raidz1",
        state: "ONLINE",
        readErrors: 0,
        writeErrors: 0,
        checksumErrors: 0,
        slowIos: 0,
        path: null,
        sizeBytes: 36e12,
        allocBytes: 18e12,
        disk: null,
        children: [
          leaf("K1", 1),
          leaf("K2", 2, { checksumErrors: 4 }),
          leaf("K3", 3, { disk: null }),
        ],
      },
    ],
  },
};

function disk(
  id: number,
  alias: string,
  state: string,
  overrides: object = {},
) {
  return {
    id,
    alias,
    model: "WDC WUH721212AL",
    modelShort: "Ultrastar HC520",
    serial: `S${id}`,
    interfaceLabel: "SATA 6 Gb/s",
    state,
    stateOverride: null,
    latestStatus: "passed",
    latestTemp: 36,
    capacityBytes: 12e12,
    media: id === 4 ? "ssd" : "hdd",
    purpose: null,
    tempThresholds: { warning: 45, error: 55 },
    present: true,
    lastSeenHostId: 1,
    hostName: "mars",
    ...overrides,
  };
}

const boxy = { ...mars, id: 2, name: "boxy" };

beforeEach(() => {
  clearNuxtData();
  hosts = [];
  pools = [];
  disks = [];
});

describe("index page", () => {
  it("shows first-run guidance when no hosts have reported", async () => {
    const page = await mountPage();

    expect(page.text()).toContain("No hosts have reported yet.");
    expect(page.get('[data-testid="command"]').text()).toContain(
      "ab".repeat(32),
    );
  });

  it("shows a host without pools yet", async () => {
    hosts = [mars];

    const page = await mountPage();

    expect(page.text()).not.toContain("No hosts have reported yet.");
    expect(page.get('[data-testid="host-section"]').text()).toContain("mars");
    expect(page.text()).toContain("No pools reported yet.");
  });

  it("lays out pools as vdev rows of disk tiles with host disks and a rail", async () => {
    hosts = [mars];
    pools = [tank];
    disks = [
      disk(1, "K1", "in-use"),
      disk(2, "K2", "in-use"),
      disk(4, "Z9", "spare"),
      disk(5, "OLD1", "missing", { present: false }),
    ];

    const page = await mountPage();

    const header = page.get('[data-testid="host-section"] header').text();
    expect(header).toContain("zfs:");
    expect(header).toContain("tank: scrub 50 %");
    expect(page.get('[data-testid="host-summary"]').text()).toBe(
      "4 disks · 3 HDD · 1 SSD · 48.0 TB raw",
    );
    expect(page.find('[data-testid="scan-progress"]').exists()).toBe(true);

    const group = page.get('[data-testid="vdev-group"]');
    expect(group.text()).toContain("raidz1-0");
    expect(group.get('[data-testid="vdev-usage"]').text()).toBe(
      "18.0 TB of 36.0 TB · 50 %",
    );
    const tiles = group.findAll('[data-testid="disk-tile"]');
    expect(
      tiles.map((tile) => tile.get('[data-testid="disk-tile-label"]').text()),
    ).toEqual(["K1", "K2", "K3"]);
    expect(tiles[0]?.attributes("href")).toBe("/disks/1");
    expect(tiles[0]?.text()).toContain("Ultrastar HC520");
    expect(tiles[1]?.text()).toContain("C4");
    expect(tiles[2]?.attributes("href")).toBeUndefined();

    const other = page.get('[data-testid="other-disks-card"]');
    expect(other.text()).toContain("other");
    expect(other.text()).toContain("Z9");
    expect(other.find('[data-media="ssd"]').exists()).toBe(true);

    const rail = page.get('[data-testid="disk-rail"]').text();
    expect(rail).toContain("Missing");
    expect(rail).toContain("OLD1");
    expect(rail).not.toContain("Z9");
    expect(rail).not.toContain("K1");
  });

  it("shows a dead disk plugged into boxy under boxy, not in the rail", async () => {
    hosts = [mars, boxy];
    disks = [
      disk(8, "RMA1", "dead", {
        stateOverride: "dead",
        lastSeenHostId: 2,
        hostName: "boxy",
      }),
    ];

    const page = await mountPage();

    const [marsSection, boxySection] = page.findAll(
      '[data-testid="host-section"]',
    );
    expect(marsSection?.text()).toContain("No pools reported yet.");
    expect(boxySection?.text()).not.toContain("No pools reported yet.");
    expect(
      boxySection?.get('[data-testid="other-disks-card"]').text(),
    ).toContain("RMA1");
    expect(page.get('[data-testid="disk-rail"]').text()).not.toContain("RMA1");
  });
});
