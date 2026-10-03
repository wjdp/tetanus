// @vitest-environment nuxt
import { mountSuspended } from "@nuxt/test-utils/runtime";
import { describe, expect, it } from "vitest";
import { type DiskCounters, NO_COUNTERS } from "#shared/smart/counters";
import { type DiskUsage, UNKNOWN_USAGE } from "#shared/usage";
import { findColumn } from "./columns";
import InventoryCell from "./InventoryCell.vue";
import { emptyInventoryDisk, mirrorMembership } from "./testFixtures";
import type { InventoryDisk } from "./types";

const mountCell = (
  id: string,
  overrides: Partial<InventoryDisk> = {},
  props: { currency?: string; serialShown?: boolean } = {},
) => {
  const column = findColumn(id);
  if (!column) throw new Error(`no column ${id}`);
  return mountSuspended(InventoryCell, {
    props: { column, disk: emptyInventoryDisk(overrides), ...props },
  });
};

const withCounters = (overrides: Partial<DiskCounters>) => ({
  counters: { ...NO_COUNTERS, ...overrides },
});

const DETAIL_COLUMNS = [
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

describe("InventoryCell", () => {
  it.each(DETAIL_COLUMNS)("shows a dimmed dash for an empty %s", async (id) => {
    const cell = await mountCell(id);

    expect(cell.text()).toBe("—");
    expect(cell.find(".text-dimmed").exists()).toBe(true);
  });

  describe("identity and hardware", () => {
    it("drops the model's serial line only when the serial column shows", async () => {
      const disk = { model: "ST4000VN008", serial: "ZC100001" };

      expect((await mountCell("model", disk)).text()).toContain("ZC100001");
      const withSerialColumn = await mountCell("model", disk, {
        serialShown: true,
      });
      expect(withSerialColumn.text()).toBe("ST4000VN008");
      expect((await mountCell("serial", disk)).text()).toBe("ZC100001");
    });

    it("shows firmware, form factor and first seen", async () => {
      expect((await mountCell("firmware", { firmware: "SC60" })).text()).toBe(
        "SC60",
      );
      expect(
        (await mountCell("formFactor", { formFactor: "3.5 inches" })).text(),
      ).toBe("3.5 inches");
      expect(
        (
          await mountCell("firstSeen", {
            firstSeenAt: "2024-03-09T10:00:00.000Z",
          })
        ).text(),
      ).toBe("2024-03-09");
    });

    it("ticks TRIM when supported and says no when not", async () => {
      expect(
        (await mountCell("trim", { trimSupported: true }))
          .find('[aria-label="TRIM supported"]')
          .exists(),
      ).toBe(true);
      expect((await mountCell("trim", { trimSupported: false })).text()).toBe(
        "no",
      );
    });
  });

  describe("placement", () => {
    it("dims the device path of a disk that is not present", async () => {
      const present = await mountCell("device", {
        lastDevicePath: "/dev/sdc",
        present: true,
      });
      const absent = await mountCell("device", {
        lastDevicePath: "/dev/sdc",
        present: false,
      });

      expect(present.text()).toBe("/dev/sdc");
      expect(present.classes()).not.toContain("text-dimmed");
      expect(absent.classes()).toContain("text-dimmed");
      expect(absent.attributes("title")).toBeDefined();
    });

    it("shows the vdev with its type icon", async () => {
      const cell = await mountCell("vdev", { membership: mirrorMembership() });

      expect(cell.text()).toBe("mirror-0");
      expect(cell.find('[data-vdev-type="mirror"]').exists()).toBe(true);
    });

    it.each([
      [
        "zfs",
        { kind: "zfs", fsTypes: ["zfs_member"], mounts: [], system: false },
        "zfs",
      ],
      [
        "filesystem",
        {
          kind: "filesystem",
          fsTypes: ["ext4"],
          mounts: [{ fsType: "ext4", path: "/boot", via: [] }],
          system: true,
        },
        "ext4 /boot",
      ],
      [
        "empty",
        { kind: "empty", fsTypes: [], mounts: [], system: false },
        "empty",
      ],
      ["unknown", UNKNOWN_USAGE, "—"],
    ] satisfies [string, DiskUsage, string][])(
      "shows %s usage as plain text, not a badge",
      async (_kind, usage, text) => {
        const cell = await mountCell("usage", {
          usage,
          membership: mirrorMembership(),
        });

        expect(cell.text()).toBe(text);
        expect(cell.classes().join(" ")).not.toMatch(/rounded|info/);
      },
    );

    it("dims empty usage only", async () => {
      const empty = await mountCell("usage", {
        usage: { kind: "empty", fsTypes: [], mounts: [], system: false },
      });
      const zfs = await mountCell("usage", {
        usage: { kind: "zfs", fsTypes: [], mounts: [], system: false },
      });

      expect(empty.classes()).toContain("text-dimmed");
      expect(zfs.classes()).not.toContain("text-dimmed");
    });

    it("colours the ZFS state", async () => {
      const online = await mountCell("vdevState", {
        membership: mirrorMembership(),
      });
      const faulted = await mountCell("vdevState", {
        membership: mirrorMembership({ vdevState: "FAULTED" }),
      });

      expect(online.text()).toBe("ONLINE");
      expect(online.classes().join(" ")).toContain("text-success");
      expect(faulted.classes().join(" ")).toContain("text-error");
    });
  });

  describe("health", () => {
    it("shows one badge per non-zero fault bucket, in severity order", async () => {
      const cell = await mountCell("faults", {
        faultCounts: { error: 2, warning: 0, acknowledged: 1 },
      });
      const badges = cell.findAll("[data-bucket]");

      expect(badges.map((badge) => badge.attributes("data-bucket"))).toEqual([
        "error",
        "acknowledged",
      ]);
      expect(badges.map((badge) => badge.text())).toEqual(["2", "1"]);
      expect(badges[0].classes().join(" ")).toContain("bg-error");
      expect(badges[1].classes().join(" ")).toContain("text-warning");
      expect(badges[1].classes().join(" ")).not.toContain("bg-warning ");
    });

    it("shows a solid amber badge for open warnings", async () => {
      const cell = await mountCell("faults", {
        faultCounts: { error: 0, warning: 3, acknowledged: 0 },
      });
      const [badge] = cell.findAll("[data-bucket]");

      expect(badge.attributes("data-bucket")).toBe("warning");
      expect(badge.classes()).toContain("bg-warning");
    });

    it("leaves a passed counter uncoloured, with no dot", async () => {
      const cell = await mountCell(
        "reallocated",
        withCounters({ reallocated: { value: 0, status: "passed" } }),
      );

      expect(cell.text()).toBe("0");
      expect(cell.attributes("data-status")).toBe("passed");
      expect(cell.find("[data-shape]").exists()).toBe(false);
    });

    it.each([
      ["pending", "failed", "text-error", "filled"],
      ["uncorrectable", "warning", "text-warning", "filled"],
      ["reallocated", "acknowledged", "text-warning", "filled"],
      ["pending", "accepted", "text-warning", "hollow"],
    ] as const)(
      "colours a %s counter that is %s",
      async (id, status, textClass, shape) => {
        const cell = await mountCell(
          id,
          withCounters({ [id]: { value: 1_208, status } }),
        );

        expect(cell.text()).toBe("1,208");
        expect(cell.classes()).toContain(textClass);
        expect(cell.find("[data-shape]").attributes("data-shape")).toBe(shape);
      },
    );

    it("shows wear as a percentage", async () => {
      const cell = await mountCell(
        "wear",
        withCounters({ wearPercent: { value: 85, status: "warning" } }),
      );

      expect(cell.text()).toBe("85 %");
      expect(cell.classes()).toContain("text-warning");
    });

    it("marks inferred bytes written with a tilde and an explanation", async () => {
      const exact = await mountCell(
        "written",
        withCounters({ bytesWritten: 44e12 }),
      );
      const inferred = await mountCell(
        "written",
        withCounters({ bytesWritten: 44e12, bytesWrittenInferred: true }),
      );

      expect(exact.text()).toBe("44.0 TB");
      expect(exact.attributes("title")).toBeUndefined();
      expect(inferred.text()).toBe("~44.0 TB");
      expect(inferred.attributes("title")).toContain("Estimated");
    });

    it("shows power cycles and how long ago the last reading was", async () => {
      expect(
        (await mountCell("powerCycles", { latestPowerCycles: 1234 })).text(),
      ).toBe("1,234");
      const reading = await mountCell("lastReading", {
        latestReadingAt: new Date(Date.now() - 3 * 3_600_000).toISOString(),
      });
      expect(reading.text()).toBe("3 h ago");
    });
  });

  describe("inventory", () => {
    const purchase = {
      capacityBytes: 4e12,
      inventory: {
        purchaseDate: "2023-05-01",
        purchasePrice: 200,
        supplier: "Scan",
        purchaseCondition: "refurbished" as const,
      },
    };

    it("shows price and price per TB in the configured currency", async () => {
      expect((await mountCell("price", purchase)).text()).toBe("£200.00");
      expect(
        (await mountCell("price", purchase, { currency: "EUR" })).text(),
      ).toBe("€200.00");
      expect(
        (await mountCell("pricePerTb", purchase, { currency: "EUR" })).text(),
      ).toBe("€50.00");
    });

    it("shows purchase date, supplier and condition", async () => {
      expect((await mountCell("purchased", purchase)).text()).toBe(
        "2023-05-01",
      );
      expect((await mountCell("supplier", purchase)).text()).toBe("Scan");
      expect((await mountCell("condition", purchase)).text()).toBe(
        "refurbished",
      );
    });

    it("shows notes as plain text, truncated, with the full text in the title", async () => {
      const cell = await mountCell("notes", {
        notes:
          "## Shucked\n\nFrom a **WD Elements**, see [receipt](https://x).",
      });
      const plain = "Shucked From a WD Elements, see receipt.";

      expect(cell.text()).toBe(plain);
      expect(cell.attributes("title")).toBe(plain);
      expect(cell.classes()).toContain("truncate");
    });
  });
});
