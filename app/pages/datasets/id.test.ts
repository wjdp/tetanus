// @vitest-environment nuxt
import { mountSuspended, registerEndpoint } from "@nuxt/test-utils/runtime";
import { createError } from "h3";
import { describe, expect, it } from "vitest";
import {
  endpoint,
  replicationRow,
} from "~/components/replication/testFixtures";
import DatasetPage from "./[id].vue";

const snapshot = (index: number) => ({
  id: 1000 + index,
  datasetId: 22,
  name: `auto-${String(index).padStart(3, "0")}`,
  guid: null,
  used: 1e6,
  referenced: 9e11,
  written: 2e6,
  creation: "2026-09-28T06:00:00.000Z",
  lastSeenAt: "2026-09-28T10:00:00.000Z",
  ageMs: 6 * 60 * 60_000,
});

registerEndpoint("/api/datasets/22", () => ({
  id: 22,
  poolId: 7,
  name: "tank/media/photos",
  parentId: 21,
  type: "filesystem",
  mountpoint: "/tank/media/photos",
  used: 1.5e12,
  referenced: 1.2e12,
  available: 8e12,
  logicalUsed: 1.6e12,
  compressRatio: 1.07,
  usedBySnapshots: 3e11,
  usedByDataset: 1.2e12,
  usedByChildren: 0,
  quota: 2e12,
  refQuota: null,
  reservation: null,
  recordSize: 1048576,
  compression: "zstd",
  encryption: "aes-256-gcm",
  creation: "2024-03-01T12:00:00.000Z",
  present: false,
  firstSeenAt: "2026-09-01T00:00:00.000Z",
  lastSeenAt: "2026-09-28T10:00:00.000Z",
  latestSnapshotAt: "2026-09-28T06:00:00.000Z",
  snapshotCount: 150,
  depth: 2,
  pool: { id: 7, name: "tank", guid: "4620770592528249368" },
  host: { id: 1, name: "mars", displayName: null },
  children: [],
  snapshots: Array.from({ length: 150 }, (_, index) => snapshot(150 - index)),
  readings: [],
  replications: [
    replicationRow(8, {
      source: endpoint("atlas", "tank/media/photos", { datasetId: 22 }),
      target: endpoint("styx", "vault/replica/tank/media/photos"),
      status: "late",
    }),
  ],
  diary: [
    {
      id: 5,
      subjectType: "dataset",
      subjectId: 22,
      at: "2026-09-20T09:00:00.000Z",
      kind: "manual",
      eventType: null,
      title: "Moved photos off the old array",
      body: "",
      data: null,
    },
  ],
}));

registerEndpoint("/api/datasets/404", () => {
  throw createError({ statusCode: 404, statusMessage: "Dataset not found" });
});

describe("dataset page", () => {
  it("shows the header, properties, snapshots and diary", async () => {
    const page = await mountSuspended(DatasetPage, { route: "/datasets/22" });

    expect(page.get("h1").text()).toBe("photos");
    expect(page.text()).toContain("tank/media/photos");
    expect(page.text()).toContain("destroyed");
    expect(page.get('a[href="/zfs/7"]').text()).toBe("mars · tank");

    const properties = page.get('[data-testid="properties-panel"]').text();
    expect(properties).toContain("1.07×");
    expect(properties).toContain("zstd");
    expect(properties).toContain("aes-256-gcm");
    expect(properties).toContain("2.00 TB");
    expect(properties).toContain("2024-03-01 12:00 UTC");

    expect(page.get('[data-testid="used-panel"]').text()).toContain(
      "Not enough readings",
    );
    expect(page.text()).toContain("Moved photos off the old array");

    const replications = page.get('[data-testid="dataset-replications"]');
    expect(replications.get("tbody th").text()).toMatch(/atlas\s*styx\s*1/);
    expect(replications.get('table a[href="/replications/8"]').text()).toBe(
      "vault/replica/tank/media/photos",
    );
    expect(replications.text()).toContain("Late");
  });

  it("shows snapshots newest first, a hundred at a time", async () => {
    const page = await mountSuspended(DatasetPage, { route: "/datasets/22" });
    const rows = () => page.findAll('[data-testid="snapshot-table"] tbody tr');

    expect(rows()).toHaveLength(100);
    expect(rows()[0].text()).toContain("auto-150");
    expect(rows()[0].text()).toContain("6 h");

    const more = page
      .findAll("button")
      .find((button) => button.text().startsWith("Show 50 more"));
    await more?.trigger("click");
    expect(rows()).toHaveLength(150);
  });

  it("raises a 404 for an unknown dataset", async () => {
    await expect(
      mountSuspended(DatasetPage, { route: "/datasets/404" }),
    ).rejects.toMatchObject({ statusCode: 404 });
  });
});
