import { describe, expect, it } from "vitest";
import { NO_COUNTERS } from "#shared/smart/counters";
import {
  COLUMN_GROUPS,
  columnLabel,
  DEFAULT_VISIBLE_COLUMNS,
  faultRank,
  findColumn,
  INVENTORY_COLUMNS,
  sortDisks,
  vdevPlacement,
} from "./columns";
import { emptyInventoryDisk, mirrorMembership } from "./testFixtures";
import type { InventoryDisk } from "./types";

const disk = (id: number, overrides: Partial<InventoryDisk>) =>
  emptyInventoryDisk({ id, ...overrides });

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

describe("pin33 field", () => {
  const taped = disk(1, { inventory: { pin33Taped: true } });
  const untaped = disk(2, { inventory: { pin33Taped: false } });
  const unset = disk(3, {});

  it("is null unless taped", () => {
    expect(findColumn("pin33")?.value(untaped)).toBeNull();
    expect(findColumn("pin33")?.value(unset)).toBeNull();
    expect(findColumn("pin33")?.value(taped)).toBe(1);
  });

  it("sorts untaped last in both directions", () => {
    const disks = [untaped, taped, unset];

    expect(ids(sortDisks(disks, [{ id: "pin33", desc: false }]))[0]).toBe(1);
    expect(ids(sortDisks(disks, [{ id: "pin33", desc: true }]))[0]).toBe(1);
  });
});

const fieldValue = (id: string, target: InventoryDisk) =>
  findColumn(id)?.value(target);

describe("pool and usage fields", () => {
  const member = disk(1, {
    membership: mirrorMembership(),
    usage: { kind: "zfs", fsTypes: ["zfs_member"], mounts: [], system: false },
    purpose: "system",
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
    const ids = INVENTORY_COLUMNS.map(({ id }) => id);
    expect(ids.indexOf("usage")).toBe(ids.indexOf("pool") + 1);
  });

  it("uses the pool name, then the purpose, for pool", () => {
    expect(fieldValue("pool", member)).toBe("tank");
    expect(fieldValue("pool", boot)).toBe("system");
    expect(fieldValue("pool", disk(3, {}))).toBeNull();
  });

  it("uses the short usage wording for usage", () => {
    expect(fieldValue("usage", member)).toBe("zfs");
    expect(fieldValue("usage", boot)).toBe("ext4 /");
    expect(fieldValue("usage", disk(3, {}))).toBeNull();
  });
});

describe("hardware sorting", () => {
  const disks = [
    disk(1, { media: "ssd", rotationRate: 0, interface: "nvme" }),
    disk(2, {
      media: "hdd",
      rotationRate: 7200,
      interface: "sata",
      link: "sas",
    }),
    disk(3, {
      media: "hdd",
      rotationRate: 5400,
      interface: "sata",
      link: "sata",
    }),
    disk(4, {}),
  ];

  it("sorts media by label with rotation rate, unknown last", () => {
    expect(ids(sortDisks(disks, [{ id: "media", desc: false }]))).toEqual([
      3, 2, 1, 4,
    ]);
  });

  it("sorts interface by displayed label", () => {
    expect(ids(sortDisks(disks, [{ id: "interface", desc: false }]))).toEqual([
      1, 3, 2, 4,
    ]);
  });

  it("sorts sector format and treats unknown recording as missing", () => {
    const sectors = [
      disk(1, { logicalBlockSize: 4096, physicalBlockSize: 4096 }),
      disk(2, { logicalBlockSize: 512, physicalBlockSize: 4096 }),
    ];
    expect(ids(sortDisks(sectors, [{ id: "sectors", desc: false }]))).toEqual([
      1, 2,
    ]);
    const recording = [
      disk(1, { recordingTech: "unknown" }),
      disk(2, { recordingTech: "smr" }),
    ];
    expect(
      ids(sortDisks(recording, [{ id: "recording", desc: true }])),
    ).toEqual([2, 1]);
  });
});

describe("INVENTORY_COLUMNS", () => {
  it("has unique ids", () => {
    const ids = INVENTORY_COLUMNS.map(({ id }) => id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("shows locked columns by default", () => {
    for (const { id } of INVENTORY_COLUMNS.filter(({ locked }) => locked)) {
      expect(DEFAULT_VISIBLE_COLUMNS.has(id)).toBe(true);
    }
    expect(findColumn("alias")?.locked).toBe(true);
  });
});

const NEW_COLUMN_IDS = [
  "serial",
  "firmware",
  "device",
  "vdev",
  "vdevState",
  "powerCycles",
  "lastReading",
  "firstSeen",
  "formFactor",
  "trim",
  "purchased",
  "price",
  "pricePerTb",
  "supplier",
  "condition",
  "notes",
  "faults",
  "reallocated",
  "pending",
  "uncorrectable",
  "wear",
  "written",
];

describe("detail columns", () => {
  it("registers every one, hidden by default, in a known group", () => {
    for (const id of NEW_COLUMN_IDS) {
      const column = findColumn(id);
      expect(column, id).toBeDefined();
      expect(column?.defaultVisible, id).toBe(false);
      expect(COLUMN_GROUPS, id).toContain(column?.group);
    }
  });

  it("is null for every one on a disk that knows nothing", () => {
    const blank = disk(1, {});
    for (const id of NEW_COLUMN_IDS) {
      expect(fieldValue(id, blank), id).toBeNull();
    }
  });

  it("puts first seen under Identity", () => {
    expect(findColumn("firstSeen")?.group).toBe("Identity");
  });

  it("sorts timestamps numerically, newest last ascending", () => {
    const disks = [
      disk(1, { latestReadingAt: "2026-10-02T12:00:00.000Z" }),
      disk(2, { latestReadingAt: null }),
      disk(3, { latestReadingAt: "2026-09-30T12:00:00.000Z" }),
    ];
    expect(ids(sortDisks(disks, [{ id: "lastReading", desc: false }]))).toEqual(
      [3, 1, 2],
    );
    expect(ids(sortDisks(disks, [{ id: "lastReading", desc: true }]))).toEqual([
      1, 3, 2,
    ]);
  });

  it("sorts TRIM as a number, unknown last", () => {
    const disks = [
      disk(1, { trimSupported: true }),
      disk(2, { trimSupported: null }),
      disk(3, { trimSupported: false }),
    ];
    expect(ids(sortDisks(disks, [{ id: "trim", desc: false }]))).toEqual([
      3, 1, 2,
    ]);
  });

  it("treats blank notes and supplier as empty and strips markdown", () => {
    expect(fieldValue("notes", disk(1, { notes: "  \n" }))).toBeNull();
    expect(
      fieldValue("notes", disk(1, { notes: "**Shucked** from a WD" })),
    ).toBe("Shucked from a WD");
    expect(
      fieldValue("supplier", disk(1, { inventory: { supplier: " " } })),
    ).toBeNull();
  });
});

describe("vdev column", () => {
  it("names the group vdev with its type", () => {
    expect(vdevPlacement(mirrorMembership())).toEqual({
      type: "mirror",
      label: "mirror-0",
    });
  });

  it("calls a top-level disk a stripe", () => {
    expect(
      vdevPlacement(mirrorMembership({ groupName: "tank", groupType: "root" })),
    ).toEqual({ type: "disk", label: "stripe" });
  });

  it("falls back to the vdev name with no group", () => {
    expect(
      vdevPlacement(mirrorMembership({ groupName: null, groupType: null })),
    ).toEqual({ type: "disk", label: "/dev/disk/by-id/ata-K1" });
  });

  it("reads the vdev state for ZFS state", () => {
    expect(
      fieldValue(
        "vdevState",
        disk(1, { membership: mirrorMembership({ vdevState: "DEGRADED" }) }),
      ),
    ).toBe("DEGRADED");
  });
});

describe("faults column", () => {
  it("is null with no live faults", () => {
    expect(faultRank({ error: 0, warning: 0, acknowledged: 0 })).toBeNull();
  });

  it("ranks open errors over warnings over acknowledged", () => {
    const disks = [
      disk(1, { faultCounts: { error: 0, warning: 0, acknowledged: 5 } }),
      disk(2, { faultCounts: { error: 1, warning: 0, acknowledged: 0 } }),
      disk(3, { faultCounts: { error: 0, warning: 0, acknowledged: 0 } }),
      disk(4, { faultCounts: { error: 0, warning: 2, acknowledged: 0 } }),
      disk(5, { faultCounts: { error: 0, warning: 1, acknowledged: 9 } }),
      disk(6, { faultCounts: { error: 1, warning: 1, acknowledged: 0 } }),
    ];
    expect(ids(sortDisks(disks, [{ id: "faults", desc: true }]))).toEqual([
      6, 2, 4, 5, 1, 3,
    ]);
  });

  it("keeps the order when a bucket overflows its weight", () => {
    const flood = faultRank({ error: 0, warning: 5000, acknowledged: 5000 });
    const oneError = faultRank({ error: 1, warning: 0, acknowledged: 0 });
    expect(flood).toBeLessThan(oneError ?? 0);
  });
});

describe("price columns", () => {
  const priced = (id: number, purchasePrice: number, capacityBytes: number) =>
    disk(id, { inventory: { purchasePrice }, capacityBytes });

  it("divides price by capacity in TB", () => {
    expect(fieldValue("pricePerTb", priced(1, 200, 4e12))).toBe(50);
    expect(
      fieldValue("pricePerTb", disk(1, { inventory: { purchasePrice: 200 } })),
    ).toBeNull();
  });

  it("sorts by price per TB, not by price", () => {
    const disks = [priced(1, 300, 12e12), priced(2, 100, 2e12), disk(3, {})];
    expect(ids(sortDisks(disks, [{ id: "pricePerTb", desc: false }]))).toEqual([
      1, 2, 3,
    ]);
    expect(ids(sortDisks(disks, [{ id: "price", desc: false }]))).toEqual([
      2, 1, 3,
    ]);
  });

  it("labels price per TB with the currency symbol", () => {
    const column = findColumn("pricePerTb");
    expect(column && columnLabel(column, "EUR")).toBe("€/TB");
    expect(column && columnLabel(column, "GBP")).toBe("£/TB");
    const price = findColumn("price");
    expect(price && columnLabel(price, "EUR")).toBe("Price");
  });
});

describe("health counter columns", () => {
  const counters = (overrides: Partial<InventoryDisk["counters"]>) => ({
    ...NO_COUNTERS,
    ...overrides,
  });

  it("sorts counters by value with missing last", () => {
    const disks = [
      disk(1, {
        counters: counters({ reallocated: { value: 8, status: "warning" } }),
      }),
      disk(2, {}),
      disk(3, {
        counters: counters({ reallocated: { value: 0, status: "passed" } }),
      }),
    ];
    expect(ids(sortDisks(disks, [{ id: "reallocated", desc: true }]))).toEqual([
      1, 3, 2,
    ]);
  });

  it("reads wear and written, inferred or not", () => {
    const ssd = disk(1, {
      counters: counters({
        wearPercent: { value: 12, status: "passed" },
        bytesWritten: 44e12,
        bytesWrittenInferred: true,
      }),
    });
    expect(fieldValue("wear", ssd)).toBe(12);
    expect(fieldValue("written", ssd)).toBe(44e12);
  });
});
