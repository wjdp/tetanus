import { describe, expect, it } from "vitest";
import {
  ALL,
  CLEARED_FILTERS,
  disposedCount,
  facetCounts,
  filterDisks,
  type InventoryFilterState,
  isFiltered,
  NONE,
} from "./filterDisks";
import { emptyInventoryDisk, mirrorMembership } from "./testFixtures";
import type { InventoryDisk } from "./types";

const disk = (overrides: Partial<InventoryDisk>): InventoryDisk =>
  emptyInventoryDisk({
    model: "ST4000VN008",
    serial: "ZC100001",
    capacityBytes: 4e12,
    hostName: "mars",
    latestTemp: 34,
    tempThresholds: { warning: 45, error: 55 },
    latestPowerOnHours: 20_000,
    ageDays: 400,
    warrantyDaysLeft: 500,
    usage: { kind: "empty", fsTypes: [], mounts: [], system: false },
    ...overrides,
  });

const tank = mirrorMembership();

const DISKS = [
  disk({
    id: 1,
    alias: "K1",
    hostName: "mars",
    membership: tank,
    usage: { kind: "zfs", fsTypes: [], mounts: [], system: false },
    media: "hdd",
    interface: "sata",
    recordingTech: "smr",
    vendor: "western-digital",
  }),
  disk({
    id: 2,
    alias: "K2",
    hostName: "mars",
    media: "ssd",
    interface: "nvme",
    vendor: "samsung",
    purpose: "system",
    latestStatus: "warning",
  }),
  disk({
    id: 3,
    alias: "K3",
    hostName: "venus",
    membership: tank,
    media: "unknown",
    interface: "unknown",
    recordingTech: "unknown",
    state: "spare",
    latestStatus: "failed",
  }),
  disk({
    id: 4,
    alias: null,
    serial: "LOOSE01",
    hostName: null,
    state: "retired",
    latestStatus: "unknown",
  }),
  disk({
    id: 5,
    alias: "GONE",
    hostName: "mars",
    state: "removed",
    present: false,
    disposal: { kind: "sold", on: "2026-09-01", salePrice: 40 },
  }),
];

const aliases = (filters: Partial<InventoryFilterState>) =>
  filterDisks(DISKS, { ...CLEARED_FILTERS, ...filters }).map(
    ({ alias, serial }) => alias ?? serial,
  );

describe("filterDisks", () => {
  it("keeps every owned disk when cleared", () => {
    expect(aliases({})).toEqual(["K1", "K2", "K3", "LOOSE01"]);
  });

  it("includes disposed disks only on request", () => {
    expect(aliases({ includeDisposed: true })).toEqual([
      "K1",
      "K2",
      "K3",
      "LOOSE01",
      "GONE",
    ]);
    expect(aliases({ includeDisposed: true, host: "mars" })).toEqual([
      "K1",
      "K2",
      "GONE",
    ]);
  });

  it.each<[Partial<InventoryFilterState>, string[]]>([
    [{ host: "mars" }, ["K1", "K2"]],
    [{ host: NONE }, ["LOOSE01"]],
    [{ pool: "tank" }, ["K1", "K3"]],
    [{ pool: NONE }, ["K2", "LOOSE01"]],
    [{ usage: "zfs" }, ["K1"]],
    [{ purpose: "system" }, ["K2"]],
    [{ purpose: NONE }, ["K1", "K3", "LOOSE01"]],
    [{ media: "ssd" }, ["K2"]],
    [{ media: NONE }, ["K3", "LOOSE01"]],
    [{ interface: "sata" }, ["K1"]],
    [{ interface: NONE }, ["K3", "LOOSE01"]],
    [{ recording: "smr" }, ["K1"]],
    [{ recording: NONE }, ["K2", "K3", "LOOSE01"]],
    [{ vendor: "samsung" }, ["K2"]],
    [{ vendor: NONE }, ["K3", "LOOSE01"]],
    [{ states: ["spare", "retired"] }, ["K3", "LOOSE01"]],
    [{ statuses: ["warning", "failed"] }, ["K2", "K3"]],
    [{ search: "loose" }, ["LOOSE01"]],
    [{ search: " st4000 " }, ["K1", "K2", "K3", "LOOSE01"]],
    [{ host: "mars", media: "hdd" }, ["K1"]],
  ])("filters by %o", (filters, expected) => {
    expect(aliases(filters)).toEqual(expected);
  });
});

describe("tag facet", () => {
  const tagged = [
    disk({ id: 1, alias: "T1", inventory: { tags: ["spare", "offsite"] } }),
    disk({ id: 2, alias: "T2", inventory: { tags: ["spare"] } }),
    disk({ id: 3, alias: "T3" }),
  ];

  it("matches a disk carrying the tag among others", () => {
    const aliasesTagged = (tag: string) =>
      filterDisks(tagged, { ...CLEARED_FILTERS, tag }).map(
        ({ alias }) => alias,
      );
    expect(aliasesTagged("spare")).toEqual(["T1", "T2"]);
    expect(aliasesTagged("offsite")).toEqual(["T1"]);
    expect(aliasesTagged(NONE)).toEqual(["T3"]);
  });

  it("counts each tag once per disk", () => {
    expect(
      Object.fromEntries(facetCounts(tagged, CLEARED_FILTERS).tag),
    ).toEqual({
      [ALL]: 3,
      spare: 2,
      offsite: 1,
      [NONE]: 1,
    });
  });
});

describe("facetCounts", () => {
  it("counts each option across all disks when cleared", () => {
    const counts = facetCounts(DISKS, CLEARED_FILTERS);

    expect(Object.fromEntries(counts.host)).toEqual({
      [ALL]: 4,
      mars: 2,
      venus: 1,
      [NONE]: 1,
    });
    expect(counts.statuses.get("failed")).toBe(1);
    expect(counts.states.get("in-use")).toBe(2);
  });

  it("counts a facet under every other filter but its own", () => {
    const counts = facetCounts(DISKS, {
      ...CLEARED_FILTERS,
      host: "mars",
      pool: "tank",
    });

    expect(Object.fromEntries(counts.host)).toEqual({
      [ALL]: 2,
      mars: 1,
      venus: 1,
    });
    expect(Object.fromEntries(counts.pool)).toEqual({
      [ALL]: 2,
      tank: 1,
      [NONE]: 1,
    });
    expect(Object.fromEntries(counts.media)).toEqual({ [ALL]: 1, hdd: 1 });
  });

  it("counts disposed disks only when they are included", () => {
    const hidden = facetCounts(DISKS, CLEARED_FILTERS);
    const shown = facetCounts(DISKS, {
      ...CLEARED_FILTERS,
      includeDisposed: true,
    });

    expect(hidden.host.get("mars")).toBe(2);
    expect(hidden.states.get("removed")).toBeUndefined();
    expect(shown.host.get("mars")).toBe(3);
    expect(shown.states.get("removed")).toBe(1);
  });

  it("applies the search to every facet", () => {
    const counts = facetCounts(DISKS, { ...CLEARED_FILTERS, search: "K" });

    expect(counts.host.get(ALL)).toBe(3);
    expect(counts.host.get(NONE)).toBeUndefined();
  });
});

describe("disposedCount", () => {
  it("counts disposed disks under the other filters", () => {
    expect(disposedCount(DISKS, CLEARED_FILTERS)).toBe(1);
    expect(disposedCount(DISKS, { ...CLEARED_FILTERS, host: "venus" })).toBe(0);
  });
});

describe("isFiltered", () => {
  it.each<[Partial<InventoryFilterState>, boolean]>([
    [{}, false],
    [{ search: "x" }, true],
    [{ vendor: NONE }, true],
    [{ statuses: ["passed"] }, true],
    [{ includeDisposed: true }, true],
  ])("%o → %s", (filters, expected) => {
    expect(isFiltered({ ...CLEARED_FILTERS, ...filters })).toBe(expected);
  });
});
