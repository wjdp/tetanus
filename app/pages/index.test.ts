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
    disk: { id, alias, state: "in-use", latestStatus: "passed" },
    children: [],
    ...overrides,
  };
}

const tank = {
  id: 7,
  name: "tank",
  state: "ONLINE",
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

function disk(id: number, alias: string, state: string) {
  return {
    id,
    alias,
    model: "WDC WUH721212AL",
    serial: `S${id}`,
    state,
    latestStatus: "passed",
    media: id === 4 ? "ssd" : "hdd",
    hostName: "mars",
  };
}

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

  it("lays out pools as vdev rows of disk tiles with a rail of spares", async () => {
    hosts = [mars];
    pools = [tank];
    disks = [
      disk(1, "K1", "in-use"),
      disk(2, "K2", "in-use"),
      disk(4, "Z9", "spare"),
      disk(5, "OLD1", "missing"),
    ];

    const page = await mountPage();

    const header = page.get('[data-testid="host-section"] header').text();
    expect(header).toContain("zfs:");
    expect(header).toContain("tank: scrub 50 %");

    const group = page.get('[data-testid="vdev-group"]');
    expect(group.text()).toContain("raidz1-0");
    const tiles = group.findAll('[data-testid="disk-tile"]');
    expect(
      tiles.map((tile) => tile.get('[data-testid="disk-tile-label"]').text()),
    ).toEqual(["K1", "K2", "K3"]);
    expect(tiles[0]?.attributes("href")).toBe("/disks/1");
    expect(tiles[1]?.text()).toContain("C4");
    expect(tiles[2]?.attributes("href")).toBeUndefined();

    const rail = page.get('[data-testid="disk-rail"]').text();
    expect(rail).toContain("Spare");
    expect(rail).toContain("Z9");
    expect(page.find('[data-testid="disk-rail"] [title="ssd"]').exists()).toBe(
      true,
    );
    expect(rail).toContain("Missing");
    expect(rail).toContain("OLD1");
    expect(rail).not.toContain("K1");
  });
});
