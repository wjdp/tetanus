import { describe, expect, it } from "vitest";
import { UNKNOWN_USAGE } from "#shared/usage";
import { SORT_FIELDS, sortDisks } from "./inventorySort";
import type { InventoryDisk } from "./types";

const disk = (
  id: number,
  overrides: Partial<InventoryDisk>,
): InventoryDisk => ({
  id,
  alias: null,
  model: null,
  serial: null,
  capacityBytes: null,
  hostName: null,
  state: "in-use",
  stateOverride: null,
  latestStatus: "passed",
  latestTemp: null,
  latestPowerOnHours: null,
  ageDays: null,
  warrantyDaysLeft: null,
  inventory: {},
  membership: null,
  usage: UNKNOWN_USAGE,
  purpose: null,
  purposeInferred: false,
  ...overrides,
});

const ids = (disks: InventoryDisk[]) => disks.map(({ id }) => id);

describe("sortDisks", () => {
  const disks = [
    disk(1, { alias: null, latestTemp: 40 }),
    disk(2, { alias: "K10", latestTemp: null }),
    disk(3, { alias: "K2", latestTemp: 35 }),
  ];

  it("sorts aliases naturally with missing values last", () => {
    expect(ids(sortDisks(disks, [{ id: "alias", desc: false }]))).toEqual([
      3, 2, 1,
    ]);
  });

  it("keeps missing values last when descending", () => {
    expect(ids(sortDisks(disks, [{ id: "temp", desc: true }]))).toEqual([
      1, 3, 2,
    ]);
  });

  it("leaves order alone for an unknown field", () => {
    expect(ids(sortDisks(disks, [{ id: "nope", desc: false }]))).toEqual([
      1, 2, 3,
    ]);
  });
});

const fieldValue = (id: string, target: InventoryDisk) =>
  SORT_FIELDS.find((field) => field.id === id)?.value(target);

describe("pool and usage fields", () => {
  const member = disk(1, {
    membership: { poolId: 1, poolName: "tank" },
    usage: { kind: "zfs", fsTypes: ["zfs_member"], mounts: [], system: false },
    purpose: "other",
  });
  const boot = disk(2, {
    usage: {
      kind: "filesystem",
      fsTypes: ["ext4"],
      mounts: [{ fsType: "ext4", path: "/", via: [] }],
      system: true,
    },
    purpose: "system",
    purposeInferred: true,
  });

  it("orders usage directly after pool", () => {
    const ids = SORT_FIELDS.map(({ id }) => id);
    expect(ids.indexOf("usage")).toBe(ids.indexOf("pool") + 1);
  });

  it("uses the pool name, then the purpose, for pool", () => {
    expect(fieldValue("pool", member)).toBe("tank");
    expect(fieldValue("pool", boot)).toBe("system");
    expect(fieldValue("pool", disk(3, {}))).toBeNull();
  });

  it("uses the short usage wording for usage", () => {
    expect(fieldValue("usage", member)).toBe("tank");
    expect(fieldValue("usage", boot)).toBe("ext4 /");
    expect(fieldValue("usage", disk(3, {}))).toBe("?");
  });
});
