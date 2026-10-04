import { describe, expect, it } from "vitest";
import { groupDisks } from "./groupDisks";
import { emptyInventoryDisk, mirrorMembership } from "./testFixtures";

const BY_ALIAS = [{ id: "alias", desc: false }];

describe("groupDisks", () => {
  const disks = [
    emptyInventoryDisk({
      id: 1,
      alias: "K3",
      vendor: "seagate",
      capacityBytes: 4e12,
      inventory: { purchasePrice: 100 },
    }),
    emptyInventoryDisk({
      id: 2,
      alias: "K1",
      vendor: null,
      capacityBytes: 2e12,
    }),
    emptyInventoryDisk({
      id: 3,
      alias: "K2",
      vendor: "seagate",
      capacityBytes: 8e12,
      inventory: { purchasePrice: 150.5 },
    }),
    emptyInventoryDisk({ id: 4, alias: "K4", vendor: "western-digital" }),
  ];

  it("orders groups by label with blanks last, disks by the sort within", () => {
    const groups = groupDisks(disks, "vendor", BY_ALIAS);
    expect(groups.map((group) => group.label)).toEqual([
      "Seagate",
      "WD",
      "Unknown vendor",
    ]);
    expect(groups[0]?.disks.map((disk) => disk.alias)).toEqual(["K2", "K3"]);
  });

  it("totals capacity and spend, spend null when nothing is priced", () => {
    const [seagate, wd, unknown] = groupDisks(disks, "vendor", BY_ALIAS);
    expect(seagate).toMatchObject({ capacityBytes: 12e12, spend: 250.5 });
    expect(wd).toMatchObject({ capacityBytes: 0, spend: null });
    expect(unknown).toMatchObject({ capacityBytes: 2e12, spend: null });
  });

  it("follows the sort direction inside each group", () => {
    const [seagate] = groupDisks(disks, "vendor", [
      { id: "alias", desc: true },
    ]);
    expect(seagate?.disks.map((disk) => disk.alias)).toEqual(["K3", "K2"]);
  });

  it.each([
    ["host", { hostName: "mars" }, "mars", "No host"],
    ["pool", { membership: mirrorMembership() }, "tank", "No pool"],
    ["line", { specs: { line: "Exos X18" } }, "Exos X18", "Unknown line"],
    ["media", { media: "ssd" }, "SSD", "Unknown media"],
    ["interface", { interface: "nvme" }, "NVMe", "Unknown interface"],
    ["purpose", { purpose: "system" }, "system", "No purpose"],
  ] as const)(
    "names %s groups and the blank one",
    (groupBy, set, label, blank) => {
      const groups = groupDisks(
        [
          emptyInventoryDisk({ id: 1, ...set }),
          emptyInventoryDisk({ id: 2, media: "unknown", interface: "unknown" }),
        ],
        groupBy,
        BY_ALIAS,
      );
      expect(groups.map((group) => group.label)).toEqual([label, blank]);
    },
  );

  it("names state groups by the lifecycle vocabulary", () => {
    const [group] = groupDisks(
      [emptyInventoryDisk({ state: "in-use" })],
      "state",
      BY_ALIAS,
    );
    expect(group?.label).toBe("In use");
  });
});
