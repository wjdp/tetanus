// @vitest-environment nuxt
import { mountSuspended } from "@nuxt/test-utils/runtime";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import DatasetTreemap from "./DatasetTreemap.vue";
import type { DatasetTreeRow } from "./types";

const dataset = (
  id: number,
  name: string,
  parentId: number | null,
  extra: Partial<DatasetTreeRow> = {},
): DatasetTreeRow => ({
  id,
  poolId: 7,
  name,
  parentId,
  type: "filesystem",
  mountpoint: `/${name}`,
  used: 100e9,
  referenced: 60e9,
  available: 500e9,
  logicalUsed: null,
  compressRatio: 1.2,
  usedBySnapshots: 40e9,
  usedByDataset: 60e9,
  usedByChildren: 0,
  quota: null,
  refQuota: null,
  reservation: null,
  recordSize: 131072,
  compression: "lz4",
  encryption: "off",
  creation: "2024-01-01T00:00:00.000Z",
  present: true,
  firstSeenAt: "2026-09-01T00:00:00.000Z",
  lastSeenAt: "2026-09-28T10:00:00.000Z",
  latestSnapshotAt: null,
  snapshotCount: 0,
  depth: name.split("/").length - 1,
  growth: null,
  replications: [],
  ...extra,
});

const datasets = [
  dataset(1, "tank", null, {
    used: 400e9,
    usedByDataset: 0,
    usedBySnapshots: 0,
    usedByChildren: 400e9,
  }),
  dataset(2, "tank/media", 1, {
    used: 300e9,
    usedByDataset: 100e9,
    usedBySnapshots: 0,
    usedByChildren: 200e9,
    growth: {
      used: 20e9,
      data: 20e9,
      snapshots: 0,
      sinceAt: "2026-09-05T00:00:00.000Z",
    },
  }),
  dataset(3, "tank/media/films", 2, {
    used: 200e9,
    usedByDataset: 200e9,
    usedBySnapshots: 0,
  }),
  dataset(4, "tank/home", 1),
];

class StubResizeObserver {
  observe() {}
  disconnect() {}
}

beforeAll(() => {
  vi.stubGlobal("ResizeObserver", StubResizeObserver);
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(1000);
  vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(600);
});
afterAll(() => vi.unstubAllGlobals());

const mountMap = async () => {
  const map = await mountSuspended(DatasetTreemap, {
    props: { datasets, poolPath: "/zfs/nas1/tank" },
  });
  await nextTick();
  return map;
};

const crumbs = (map: Awaited<ReturnType<typeof mountMap>>) =>
  map
    .findAll('nav[aria-label="Zoom"] :is(button, [aria-current])')
    .map((crumb) => crumb.text());

describe("DatasetTreemap", () => {
  it("draws a labelled box per dataset near the top with its tiles", async () => {
    const map = await mountMap();
    const headers = map.findAll('[role="button"]');
    expect(headers.map((header) => header.attributes("aria-label"))).toEqual([
      "tank/media, 279 GiB",
      "tank/home, 93.1 GiB",
      "tank/media/films, 186 GiB",
    ]);
    expect(map.find('[data-key="4:snapshots"]').exists()).toBe(true);
    expect(map.find('a[href="/zfs/nas1/tank/media"]').exists()).toBe(true);
  });

  it("explains a tile on hover", async () => {
    const map = await mountMap();
    await map.find('[data-key="2:data"]').trigger("pointermove");
    const tooltip = map.find('[role="tooltip"]');
    expect(tooltip.text()).toContain("tank/media");
    expect(tooltip.text()).toContain("93.1 GiB · 25.0 % of pool");
    expect(tooltip.text()).toContain("+18.6 GiB since 2026-09-05");
  });

  it("zooms into a branch on click and back out with Escape", async () => {
    const map = await mountMap();
    await map.find('[data-key="3:data"]').trigger("click");
    expect(crumbs(map)).toEqual(["tank", "media"]);
    expect(map.find('[data-key="4:data"]').exists()).toBe(false);

    await map.find('[role="application"]').trigger("keydown", {
      key: "Escape",
    });
    expect(crumbs(map)).toEqual(["tank"]);
  });

  it("adds a free tile and a growth legend when toggled", async () => {
    const map = await mountMap();
    expect(map.find('[data-kind="free"]').exists()).toBe(false);
    await map.find('[role="switch"]').trigger("click");
    expect(map.find('[data-kind="free"]').exists()).toBe(true);

    await map
      .findAll("button")
      .find((button) => button.text() === "By growth")
      ?.trigger("click");
    expect(map.text()).toContain("No history");
  });
});
