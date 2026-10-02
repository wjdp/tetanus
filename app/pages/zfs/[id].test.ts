// @vitest-environment nuxt
import { mountSuspended, registerEndpoint } from "@nuxt/test-utils/runtime";
import { flushPromises } from "@vue/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { clearNuxtData } from "#app";
import type { FaultView } from "#shared/faults";
import { FakeEventSource } from "~~/test/fakeEventSource";
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
  role: "normal",
  state: "ONLINE",
  spareState: null,
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
  msgid: null,
  moreinfo: null,
  health: "ONLINE",
  errors: 0,
  damagedFiles: null,
  damagedFilesError: null,
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
  scanProgressAt: null,
  lastScrub: null,
  removal: null,
  config: null,
  resolvedConfig: { scrubIntervalDays: 35, slowIoThreshold: 10 },
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

const tankFault: FaultView = {
  id: 41,
  kind: "leaf-errors",
  category: "zfs",
  severity: "warning",
  state: "open",
  key: "7:guid-K1",
  data: {
    poolName: "tank",
    name: "/dev/disk/by-vdev/K1-part1",
    diskId: 3,
    read: 0,
    write: 0,
    checksum: 2,
    rise24h: 2,
  },
  note: "",
  openedAt: "2026-09-28T09:00:00.000Z",
  lastSeenAt: "2026-09-28T10:00:00.000Z",
  resolvedAt: null,
  stateChangedAt: "2026-09-28T09:00:00.000Z",
  subject: { type: "pool", id: 7, label: "tank", hostName: "mars" },
};

const faultQueries: Record<string, string>[] = [];
let tankFaultState: FaultView["state"] = "open";
registerEndpoint("/api/faults", (event) => {
  const query = Object.fromEntries(
    new URL(event.path, "http://x").searchParams,
  );
  faultQueries.push(query);
  const faults =
    query.subject === "pool:7" ? [{ ...tankFault, state: tankFaultState }] : [];
  return {
    faults,
    counts: { open: faults.length, acknowledged: 0, accepted: 0, resolved: 0 },
    badge: 0,
  };
});
registerEndpoint("/api/faults/41/resolve", {
  method: "POST",
  handler: () => {
    tankFaultState = "resolved";
    return {};
  },
});

const damagedFiles = Array.from(
  { length: 100 },
  (_, index) => `/tfault/file-${index}`,
);
const vdevHistoryRequests: string[] = [];
const configPatches: unknown[] = [];
let degradedConfig = { scrubIntervalDays: 35, slowIoThreshold: 10 };
const degraded = () => ({
  ...tank,
  id: 10,
  name: "zeta",
  state: "DEGRADED",
  status: "One or more devices has experienced an error.",
  msgid: "ZFS-8000-8A",
  moreinfo: "https://openzfs.github.io/openzfs-docs/msg/ZFS-8000-8A",
  errors: 130,
  damagedFiles,
  scan: {
    function: "SCRUB",
    state: "FINISHED",
    startTime: 1789255441,
    endTime: 1789325257,
    examined: 100,
    toExamine: 100,
    processed: 4096,
    errors: 3,
  },
  removal: {
    state: "FINISHED",
    removingVdev: 0,
    startTime: 1762874276,
    endTime: 1762874490,
    toCopy: 97076903936,
    copied: 97076903936,
    mappingMemory: 3109920,
  },
  config: degradedConfig,
  resolvedConfig: degradedConfig,
  vdevs: vdev("zeta", "root", [
    vdev("mirror-0", "mirror", [
      vdev("/dev/disk/by-vdev/Z1-part1", "disk", [], {
        id: 101,
        guid: "1111",
        slowIos: 12,
        path: "/dev/disk/by-vdev/Z1-part1",
        devid: "ata-Samsung_SSD-part1",
        physPath: "pci-0000:06:00.1-ata-5.0",
        disk: { id: 18, alias: "Z1", state: "in-use", latestStatus: "passed" },
      }),
      vdev("/dev/disk/by-vdev/Z2-part1", "disk", [], {
        id: 102,
        slowIos: 4,
      }),
    ]),
    vdev("/dev/disk/by-vdev/L1-part1", "disk", [], { id: 103, role: "log" }),
    vdev("/dev/disk/by-vdev/P1-part1", "disk", [], {
      id: 104,
      role: "spare",
      state: "AVAIL",
      spareState: "AVAIL",
    }),
  ]),
  events: [
    {
      id: 1,
      hostId: 1,
      eid: 37,
      at: "2026-09-28T09:00:00.000Z",
      class: "ereport.fs.zfs.checksum",
      poolGuid: tank.guid,
      vdevGuid: "1111",
      payload: { zio_err: "52", vdev_path: "/dev/disk/by-vdev/Z1-part1" },
    },
    {
      id: 2,
      hostId: 1,
      eid: 38,
      at: "2026-09-28T09:01:00.000Z",
      class: "ereport.fs.zfs.delay",
      poolGuid: tank.guid,
      vdevGuid: "9999",
      payload: {},
    },
  ],
});
registerEndpoint("/api/pools/10", () => degraded());
registerEndpoint("/api/pools/10/config", {
  method: "PATCH",
  handler: async (event) => {
    const { readBody } = await import("h3");
    const body = await readBody(event as Parameters<typeof readBody>[0]);
    configPatches.push(body);
    degradedConfig = { ...degradedConfig, ...body };
    return degraded();
  },
});
registerEndpoint("/api/pools/10/vdevs/101/readings", (event) => {
  vdevHistoryRequests.push(event.path);
  return {
    readings: [
      {
        at: "2026-09-20T00:00:00.000Z",
        readErrors: 0,
        writeErrors: 0,
        checksumErrors: 0,
        slowIos: 2,
        state: "ONLINE",
      },
      {
        at: "2026-09-28T10:00:00.000Z",
        readErrors: 0,
        writeErrors: 0,
        checksumErrors: 0,
        slowIos: 12,
        state: "ONLINE",
      },
    ],
  };
});

beforeEach(() => {
  FakeEventSource.install();
  clearNuxtData();
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

  it("lists the pool's live faults and acts on them in place", async () => {
    tankFaultState = "open";
    const page = await mountSuspended(PoolPage, { route: "/zfs/7" });

    const list = await vi.waitFor(() =>
      page.get('[data-testid="pool-faults"]'),
    );
    expect(faultQueries).toContainEqual(
      expect.objectContaining({ subject: "pool:7" }),
    );
    expect(list.text()).toContain("K1-part1 in tank: R 0 W 0 C 2");
    expect(list.find('a[href="/disks/3"]').exists()).toBe(true);

    const resolve = list
      .findAll("button")
      .find((button) => button.text() === "Resolve");
    await resolve?.trigger("click");
    await flushPromises();

    await vi.waitFor(() =>
      expect(
        page.get('[data-testid="fault-row"]').attributes("data-state"),
      ).toBe("resolved"),
    );
  });

  it("shows data errors in the header with the damaged files collapsed", async () => {
    const page = await mountSuspended(PoolPage, { route: "/zfs/10" });

    const errors = page.get('[data-testid="pool-data-errors"]');
    expect(errors.text()).toBe("Data errors 130");
    expect(errors.classes()).toContain("text-error");

    const msgid = page.get('[data-testid="pool-msgid"]');
    expect(msgid.text()).toBe("ZFS-8000-8A");
    expect(msgid.attributes("href")).toBe(
      "https://openzfs.github.io/openzfs-docs/msg/ZFS-8000-8A",
    );

    const files = page.get('[data-testid="damaged-files"]');
    expect(files.findAll("li")).toHaveLength(10);
    expect(files.get('[data-testid="damaged-files-unlisted"]').text()).toBe(
      "+30 more not listed",
    );
    await files.get('[data-testid="damaged-files-toggle"]').trigger("click");
    expect(files.findAll("li")).toHaveLength(100);
  });

  it("shows a muted zero when the pool has no data errors", async () => {
    const page = await mountSuspended(PoolPage, { route: "/zfs/7" });
    const errors = page.get('[data-testid="pool-data-errors"]');
    expect(errors.text()).toBe("Data errors 0");
    expect(errors.classes()).toContain("text-muted");
    expect(page.find('[data-testid="damaged-files"]').exists()).toBe(false);
    expect(page.find('[data-testid="removal-panel"]').exists()).toBe(false);
  });

  it("shows scan repairs, red scan errors and the removal panel", async () => {
    const page = await mountSuspended(PoolPage, { route: "/zfs/10" });
    const scan = page.get('[data-testid="scan-panel"]');
    expect(scan.get('[data-testid="scan-repaired"]').text()).toBe("4.10 kB");
    expect(scan.get('[data-testid="scan-errors"]').classes()).toContain(
      "text-error",
    );
    const removal = page.get('[data-testid="removal-panel"]').text();
    expect(removal).toContain("2025-11-11 15:21 UTC");
    expect(removal).toContain("97.1 GB of 97.1 GB");
    expect(removal).toContain("3.11 MB");
  });

  it("groups log and spare devices, badges spares and flags slow I/Os over the threshold", async () => {
    const page = await mountSuspended(PoolPage, { route: "/zfs/10" });
    const tree = page.get('[data-testid="vdev-tree"]');

    expect(
      tree.findAll('[data-testid="vdev-section"]').map((row) => row.text()),
    ).toEqual(["logs", "spares"]);
    expect(tree.get('[data-testid="spare-state"]').text()).toBe("AVAIL");
    expect(
      tree.get('[data-testid="spare-state"]').classes().join(" "),
    ).toContain("text-success");

    const slow = tree.findAll('[data-testid="vdev-slow"]');
    const slowFor = (count: string) =>
      slow.find((cell) => cell.text() === count)?.classes();
    expect(slowFor("12")).toContain("text-warning");
    expect(slowFor("4")).not.toContain("text-warning");

    const z1 = tree
      .findAll('[data-testid="vdev-name"]')
      .find((cell) => cell.text().includes("Z1-part1"));
    expect(z1?.attributes("title")).toBe(
      "path /dev/disk/by-vdev/Z1-part1\ndevid ata-Samsung_SSD-part1\nphys path pci-0000:06:00.1-ata-5.0",
    );
  });

  it("loads a vdev's history when its row is expanded", async () => {
    const page = await mountSuspended(PoolPage, { route: "/zfs/10" });
    const expand = page
      .findAll('[data-testid="vdev-expand"]')
      .find((button) => button.attributes("aria-label")?.includes("Z1-part1"));
    expect(vdevHistoryRequests).toEqual([]);

    await expand?.trigger("click");
    await flushPromises();

    await vi.waitFor(() => expect(vdevHistoryRequests).toHaveLength(1));
    expect(page.find('[data-testid="vdev-history"]').exists()).toBe(true);
  });

  it("names each event's vdev with its disk and expands its payload", async () => {
    const page = await mountSuspended(PoolPage, { route: "/zfs/10" });
    const tab = page
      .findAll('[role="tab"]')
      .find((element) => element.text().startsWith("Events"));
    await tab?.trigger("mousedown", { button: 0 });
    await flushPromises();

    const [checksum, delay] = page.findAll('[data-testid="pool-event"]');
    expect(checksum?.get('[data-testid="pool-event-vdev"]').text()).toBe(
      "Z1-part1Z1",
    );
    expect(checksum?.find('a[href="/disks/18"]').exists()).toBe(true);
    expect(delay?.text()).toContain("vdev 9999");

    expect(checksum?.find('[data-testid="pool-event-payload"]').exists()).toBe(
      false,
    );
    await checksum?.get('[data-testid="pool-event-expand"]').trigger("click");
    const payload = checksum?.get('[data-testid="pool-event-payload"]').text();
    expect(payload).toContain("zio_err52");
    expect(payload).toContain("vdev_path/dev/disk/by-vdev/Z1-part1");
  });

  it("saves the pool settings from the header popover and refreshes", async () => {
    const page = await mountSuspended(PoolPage, {
      route: "/zfs/10",
      attachTo: document.body,
    });
    await page.get('[data-testid="pool-config"]').trigger("click");
    await flushPromises();

    const form = await vi.waitFor(() => {
      const found = document.querySelector<HTMLFormElement>(
        '[data-testid="pool-config-form"]',
      );
      if (!found) throw new Error("no config form");
      return found;
    });
    const [interval] = form.querySelectorAll("input");
    if (!interval) throw new Error("no interval input");
    interval.value = "0";
    interval.dispatchEvent(new Event("input"));
    form.dispatchEvent(new Event("submit"));
    await flushPromises();

    await vi.waitFor(() =>
      expect(configPatches).toEqual([
        { scrubIntervalDays: 0, slowIoThreshold: 10 },
      ]),
    );
    page.unmount();
  });
});
