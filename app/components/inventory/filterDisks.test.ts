import { describe, expect, it } from "vitest";
import {
  ALL,
  CLEARED_FILTERS,
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
];

const aliases = (filters: Partial<InventoryFilterState>) =>
  filterDisks(DISKS, { ...CLEARED_FILTERS, ...filters }).map(
    ({ alias, serial }) => alias ?? serial,
  );

describe("filterDisks", () => {
  it("keeps every disk when cleared", () => {
    expect(aliases({})).toEqual(["K1", "K2", "K3", "LOOSE01"]);
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

  it("applies the search to every facet", () => {
    const counts = facetCounts(DISKS, { ...CLEARED_FILTERS, search: "K" });

    expect(counts.host.get(ALL)).toBe(3);
    expect(counts.host.get(NONE)).toBeUndefined();
  });
});

describe("isFiltered", () => {
  it.each<[Partial<InventoryFilterState>, boolean]>([
    [{}, false],
    [{ search: "x" }, true],
    [{ vendor: NONE }, true],
    [{ statuses: ["passed"] }, true],
  ])("%o → %s", (filters, expected) => {
    expect(isFiltered({ ...CLEARED_FILTERS, ...filters })).toBe(expected);
  });
});
