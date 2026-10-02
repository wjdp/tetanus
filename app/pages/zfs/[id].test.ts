// @vitest-environment nuxt
import { mountSuspended, registerEndpoint } from "@nuxt/test-utils/runtime";
import { flushPromises } from "@vue/test-utils";
import { describe, expect, it, vi } from "vitest";
import PoolPage from "./[id].vue";

const vdev = (
  name: string,
  type: string,
  children: object[] = [],
  extra = {},
) => ({
  id: name.length,
  guid: `guid-${name}`,
  parentId: null,
  name,
  type,
  state: "ONLINE",
  readErrors: 0,
  writeErrors: 0,
  checksumErrors: 0,
  slowIos: 0,
  path: null,
  devid: null,
  physPath: null,
  allocBytes: null,
  sizeBytes: null,
  frag: null,
  present: true,
  lastSeenAt: "2026-09-28T10:00:00.000Z",
  disk: null,
  children,
  ...extra,
});

const tank = {
  id: 7,
  guid: "4620770592528249368",
  name: "tank",
  state: "ONLINE",
  status: "Some supported features are not enabled.",
  action: null,
  health: "ONLINE",
  errors: 0,
  sizeBytes: 36e12,
  allocBytes: 18e12,
  freeBytes: 18e12,
  frag: 3,
  cap: 50,
  dedup: 1,
  scan: {
    function: "SCRUB",
    state: "FINISHED",
    startTime: 1789255441,
    endTime: 1789325257,
    examined: 100,
    toExamine: 100,
    errors: 0,
  },
  firstSeenAt: "2026-09-01T00:00:00.000Z",
  lastSeenAt: "2026-09-28T10:00:00.000Z",
  host: { id: 1, name: "mars", displayName: null },
  vdevs: vdev("tank", "root", [
    vdev("raidz1-0", "raidz1", [
      vdev("/dev/disk/by-vdev/K1-part1", "disk", [], {
        checksumErrors: 2,
        disk: { id: 3, alias: "K1", state: "in-use", latestStatus: "passed" },
      }),
      vdev("/dev/disk/by-vdev/K2-part1", "disk", [], {
        id: 99,
        disk: { id: 4, alias: "K2", state: "in-use", latestStatus: "unknown" },
      }),
    ]),
  ]),
  readings: [],
  diary: [],
  history: [
    {
      id: 1,
      hostId: 1,
      poolId: null,
      at: "2026-09-20T02:00:00.000Z",
      internal: false,
      text: "zpool scrub tank",
    },
  ],
  historyScope: "host",
  events: [],
  datasetCount: 2,
  snapshotCount: 0,
};

registerEndpoint("/api/pools/7", () => tank);
registerEndpoint("/api/pools/8", () => ({ ...tank, id: 8, cap: 92 }));
registerEndpoint("/api/pools/8/datasets", () => ({ datasets: [] }));

let tfaultArchived = true;
const tfault = () => ({
  ...tank,
  id: 9,
  name: "tfault",
  archivedAt: tfaultArchived ? "2026-10-02T09:00:00.000Z" : null,
  archiveNote: tfaultArchived ? "fixture capture" : "",
});
registerEndpoint("/api/pools/9", () => tfault());
registerEndpoint("/api/pools/9/archive", {
  method: "DELETE",
  handler: () => {
    tfaultArchived = false;
    return tfault();
  },
});

const datasetRequests: string[] = [];

registerEndpoint("/api/pools/7/datasets", (event) => {
  datasetRequests.push(event.path);
  return {
    datasets: [
      {
        id: 21,
        name: "tank",
        parentId: null,
        depth: 0,
        type: "filesystem",
        used: 1e12,
        referenced: 1e9,
        compressRatio: 1,
        quota: null,
        snapshotCount: 0,
        latestSnapshotAt: null,
        present: true,
      },
      {
        id: 22,
        name: "tank/media",
        parentId: 21,
        depth: 1,
        type: "filesystem",
        used: 9e11,
        referenced: 9e11,
        compressRatio: 1.01,
        quota: null,
        snapshotCount: 3,
        latestSnapshotAt: "2026-09-28T09:00:00.000Z",
        present: true,
      },
    ],
  };
});

describe("pool page", () => {
  it("shows the header, scan and vdev tree", async () => {
    const page = await mountSuspended(PoolPage, { route: "/zfs/7" });

    expect(page.get("h1").text()).toBe("tank");
    expect(page.text()).toContain("4620770592528249368");
    expect(page.text()).toContain("Some supported features are not enabled.");
    expect(page.get('[data-testid="scan-panel"]').text()).toContain("finished");

    const tree = page.get('[data-testid="vdev-tree"]').text();
    expect(tree).toContain("raidz1-0");
    expect(tree).toContain("K1");
    expect(page.find('a[href="/disks/3"]').exists()).toBe(true);
  });

  it("colours ONLINE green and marks vdev types and SMART dots", async () => {
    const page = await mountSuspended(PoolPage, { route: "/zfs/7" });
    expect(page.get('[data-testid="pool-state"]').classes()).toContain(
      "text-success",
    );
    const tree = page.get('[data-testid="vdev-tree"]');

    for (const state of tree.findAll('[data-testid="vdev-state"]')) {
      expect(state.classes()).toContain("text-success");
    }
    expect(
      tree
        .findAll("[data-vdev-type]")
        .map((icon) => icon.attributes("data-vdev-type")),
    ).toEqual(["raidz1"]);

    const dots = tree.findAll("[data-shape]");
    expect(
      dots.map((dot) => [
        dot.attributes("data-colour"),
        dot.attributes("data-shape"),
      ]),
    ).toEqual([
      ["success", "filled"],
      ["neutral", "hollow"],
    ]);
  });

  it("colours the capacity bar by the capacity thresholds", async () => {
    const indicator = async (route: string) =>
      (await mountSuspended(PoolPage, { route }))
        .get('[data-testid="pool-capacity-bar"] [data-slot="indicator"]')
        .classes();

    expect(await indicator("/zfs/7")).toContain("bg-inverted");
    expect(await indicator("/zfs/8")).toContain("bg-error");
  });

  it("loads the dataset tree when its tab is first shown", async () => {
    const page = await mountSuspended(PoolPage, { route: "/zfs/7" });
    const tab = page
      .findAll('[role="tab"]')
      .find((element) => element.text().startsWith("Datasets"));

    expect(tab?.text()).toContain("2");
    expect(datasetRequests).toEqual([]);

    await tab?.trigger("mousedown", { button: 0 });
    await flushPromises();

    await vi.waitFor(() =>
      expect(page.find('a[href="/datasets/22"]').exists()).toBe(true),
    );
    expect(datasetRequests).toHaveLength(1);
  });

  it("shows no archive banner for a pool in use", async () => {
    const page = await mountSuspended(PoolPage, { route: "/zfs/7" });
    expect(page.find('[data-testid="pool-archived-banner"]').exists()).toBe(
      false,
    );
  });

  it("shows an archived pool's date and note in a banner, and unarchives it", async () => {
    tfaultArchived = true;
    const page = await mountSuspended(PoolPage, { route: "/zfs/9" });

    const banner = page.get('[data-testid="pool-archived-banner"]');
    expect(banner.text()).toContain("Archived 2026-10-02 · fixture capture");

    await banner.get("button").trigger("click");
    await flushPromises();

    await vi.waitFor(() =>
      expect(page.find('[data-testid="pool-archived-banner"]').exists()).toBe(
        false,
      ),
    );
  });
});
