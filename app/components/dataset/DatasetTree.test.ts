// @vitest-environment nuxt
import { mountSuspended } from "@nuxt/test-utils/runtime";
import { describe, expect, it } from "vitest";
import DatasetTree from "./DatasetTree.vue";
import type { DatasetTreeRow } from "./types";

const now = Date.parse("2026-09-28T12:00:00.000Z");

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
  used: 2e12,
  referenced: 1e12,
  available: 10e12,
  logicalUsed: 2.1e12,
  compressRatio: 1.01,
  usedBySnapshots: 0,
  usedByDataset: 1e12,
  usedByChildren: 1e12,
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
  dataset(1, "tank", null),
  dataset(2, "tank/media", 1, {
    quota: 5e12,
    snapshotCount: 12,
    latestSnapshotAt: "2026-09-28T09:00:00.000Z",
  }),
  dataset(3, "tank/media/photos", 2, {
    replications: [
      { id: 8, role: "source", status: "late" },
      { id: 9, role: "target", status: "ok" },
    ],
  }),
  dataset(4, "tank/vm-disk", 1, { type: "volume", mountpoint: null }),
  dataset(5, "tank/old", 1, { present: false }),
];

const mountTree = () =>
  mountSuspended(DatasetTree, {
    props: { datasets, poolPath: "/zfs/nas1/tank", now },
  });

const rowTexts = (tree: Awaited<ReturnType<typeof mountTree>>) =>
  tree.findAll("tbody tr").map((row) => row.text());

describe("DatasetTree", () => {
  it("indents by depth and shows the last name segment", async () => {
    const tree = await mountTree();
    const names = tree.findAll('[data-testid="dataset-name"]');

    expect(names.map((name) => name.attributes("data-depth"))).toEqual([
      "0",
      "1",
      "2",
      "1",
      "1",
    ]);
    expect(names[2].attributes("style")).toContain("padding-left: 2.5rem");
    const photos = names[2].get('a[href="/zfs/nas1/tank/media/photos"]');
    expect(photos.text()).toBe("photos");
    expect(photos.attributes("title")).toBe("tank/media/photos");
  });

  it("shows ratio, quota, snapshot count, age and volume badge", async () => {
    const [, media, , volume] = rowTexts(await mountTree());

    expect(media).toContain("1.01×");
    expect(media).toContain("4.55 TiB");
    expect(media).toContain("12");
    expect(media).toContain("3 h ago");
    expect(volume).toContain("volume");
  });

  it("collapses and expands children", async () => {
    const tree = await mountTree();

    await tree.get('button[aria-label="Collapse tank/media"]').trigger("click");
    expect(tree.find('a[href="/zfs/nas1/tank/media/photos"]').exists()).toBe(
      false,
    );
    expect(tree.find('a[href="/zfs/nas1/tank/vm-disk"]').exists()).toBe(true);

    await tree.get('button[aria-label="Expand tank/media"]').trigger("click");
    expect(tree.find('a[href="/zfs/nas1/tank/media/photos"]').exists()).toBe(
      true,
    );
  });

  it("puts destroyed datasets last, greyed with a badge", async () => {
    const tree = await mountTree();
    const rows = tree.findAll("tbody tr");
    const last = rows.at(-1);

    expect(last?.text()).toContain("old");
    expect(last?.text()).toContain("destroyed");
    expect(last?.classes()).toContain("opacity-50");
  });

  it("links each replication with its role icon and status dot", async () => {
    const tree = await mountTree();
    const links = tree.findAll('[data-testid="dataset-replication"]');

    expect(links.map((link) => link.attributes("href"))).toEqual([
      "/replications/8",
      "/replications/9",
    ]);
    expect(links[0].attributes("data-role")).toBe("source");
    expect(links[0].attributes("title")).toBe("Sends · Late");
    expect(links[0].get("[data-colour]").attributes("data-colour")).toBe(
      "warning",
    );
    expect(links[1].attributes("title")).toBe("Receives · OK");
  });
});
