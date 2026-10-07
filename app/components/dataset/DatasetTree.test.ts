// @vitest-environment nuxt
import { mountSuspended } from "@nuxt/test-utils/runtime";
import { beforeEach, describe, expect, it } from "vitest";
import { nextTick } from "vue";
import { DATASET_COLUMNS_COOKIE } from "~/composables/useDatasetColumns";
import { clearCookie } from "~~/test/cookies";
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
  keyStatus: null,
  encryptionRoot: null,
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
  dataset(1, "tank", null, { used: 4e12 }),
  dataset(2, "tank/media", 1, {
    quota: 5e12,
    usedByDataset: 5e11,
    usedBySnapshots: 2.5e11,
    reservation: 10 * 2 ** 30,
    encryption: "aes-256-gcm",
    growth: {
      used: 2 ** 30,
      data: 2 ** 30,
      snapshots: 0,
      sinceAt: "2026-08-29T12:00:00.000Z",
    },
    snapshotCount: 12,
    latestSnapshotAt: "2026-09-28T09:00:00.000Z",
  }),
  dataset(3, "tank/media/photos", 2, {
    replications: [
      {
        id: 8,
        role: "source",
        status: "late",
        peer: {
          host: { name: "vault", displayName: "Vault" },
          pool: "vpool",
          dataset: "vpool/photos",
          sameHost: false,
        },
      },
      {
        id: 9,
        role: "target",
        status: "ok",
        peer: {
          host: { name: "nas1", displayName: null },
          pool: "scratch",
          dataset: "scratch/photos",
          sameHost: true,
        },
      },
    ],
  }),
  dataset(4, "tank/vm-disk", 1, {
    type: "volume",
    mountpoint: null,
    used: 3e12,
  }),
  dataset(5, "tank/old", 1, { present: false }),
];

const mountTree = () =>
  mountSuspended(DatasetTree, {
    props: { datasets, poolPath: "/zfs/nas1/tank", now },
  });

const rowTexts = (tree: Awaited<ReturnType<typeof mountTree>>) =>
  tree.findAll("tbody tr").map((row) => row.text());

beforeEach(() => {
  clearCookie(DATASET_COLUMNS_COOKIE);
});

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

  it("shows compression, limits, snapshots and the volume badge", async () => {
    const [, media, , volume] = rowTexts(await mountTree());

    expect(media).toContain("1.01×");
    expect(media).toContain("lz4");
    expect(media).toContain("4.55 TiB quota");
    expect(media).toContain("10.0 GiB reserved");
    expect(media).toMatch(/12\s*· 3 h ago/);
    expect(volume).toContain("volume");
  });

  it("draws used space as data, snapshot and child shares of the pool", async () => {
    const tree = await mountTree();
    const used = tree.findAll('[data-testid="dataset-used"]')[1];
    const widths = Object.fromEntries(
      used
        .findAll("[data-part]")
        .map((part) => [
          part.attributes("data-part"),
          part.attributes("style"),
        ]),
    );

    expect(used.attributes("title")).toBe(
      "Data 466 GiB · snapshots 233 GiB · children 931 GiB · reserved 233 GiB",
    );
    expect(widths.data).toContain("width: 12.5%");
    expect(widths.snapshots).toContain("width: 6.25%");
    expect(widths.children).toContain("width: 25%");
  });

  it("marks encrypted datasets with their cipher", async () => {
    const tree = await mountTree();
    const locks = tree.findAll('[data-testid="dataset-encrypted"]');

    expect(locks).toHaveLength(1);
    expect(locks[0].attributes("title")).toBe("Encrypted · aes-256-gcm");
  });

  it("shows growth with its sign and baseline date", async () => {
    const tree = await mountTree();
    const growth = tree.get('[data-testid="dataset-growth"]');

    expect(growth.text()).toBe("+1.00 GiB");
    expect(growth.attributes("title")).toContain("Since");
  });

  it("sorts siblings by a column, then reverses, then restores tree order", async () => {
    const tree = await mountTree();
    const order = () =>
      tree.findAll('[data-testid="dataset-name"] a').map((link) => link.text());
    const sortByUsed = () =>
      tree.get('[data-testid="dataset-sort-used"]').trigger("click");

    await sortByUsed();
    expect(order()).toEqual(["tank", "vm-disk", "media", "photos", "old"]);
    await sortByUsed();
    expect(order()).toEqual(["tank", "media", "photos", "vm-disk", "old"]);
    await sortByUsed();
    expect(order()).toEqual(["tank", "media", "photos", "vm-disk", "old"]);
  });

  it("collapses everything below the pool's children, and expands again", async () => {
    const tree = await mountTree();

    await tree.get('[data-testid="dataset-collapse-all"]').trigger("click");
    expect(tree.find('a[href="/zfs/nas1/tank/media"]').exists()).toBe(true);
    expect(tree.find('a[href="/zfs/nas1/tank/media/photos"]').exists()).toBe(
      false,
    );

    await tree.get('[data-testid="dataset-expand-all"]').trigger("click");
    expect(tree.find('a[href="/zfs/nas1/tank/media/photos"]').exists()).toBe(
      true,
    );
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

  it("adds an optional column picked from the columns menu", async () => {
    const tree = await mountTree();
    expect(tree.find('[data-testid="dataset-referenced"]').exists()).toBe(
      false,
    );

    tree
      .getComponent({ name: "DatasetColumnPicker" })
      .vm.$emit("toggle", "referenced", true);
    await nextTick();

    expect(tree.get('[data-testid="dataset-referenced"]').text()).toBe(
      "931 GiB",
    );
  });

  it("links each replication with its role icon and status dot", async () => {
    const tree = await mountTree();
    const links = tree.findAll('[data-testid="dataset-replication"]');

    expect(links.map((link) => link.attributes("href"))).toEqual([
      "/replications/8",
      "/replications/9",
    ]);
    expect(links[0].attributes("data-role")).toBe("source");
    expect(links[0].attributes("title")).toBe(
      "Sends to Vault:vpool/photos · Late",
    );
    expect(links[0].text()).toBe("Vault");
    expect(links[0].get("[data-colour]").attributes("data-colour")).toBe(
      "warning",
    );
    expect(links[1].attributes("title")).toBe(
      "Receives from nas1:scratch/photos · OK",
    );
    expect(links[1].text()).toBe("scratch");
  });
});
