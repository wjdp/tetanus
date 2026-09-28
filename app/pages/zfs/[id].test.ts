// @vitest-environment nuxt
import { mountSuspended, registerEndpoint } from "@nuxt/test-utils/runtime";
import { describe, expect, it } from "vitest";
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

registerEndpoint("/api/pools/7", () => ({
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
}));

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
});
