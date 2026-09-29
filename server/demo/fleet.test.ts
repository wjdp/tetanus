import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { inventorySchema } from "#shared/inventory-fields";
import { lookupSpec } from "~~/server/services/drive-db/lookup";
import { byIdNames, SERIAL_FORMATS, WWN_PREFIXES } from "./fleet";
import { DAY_MS, DEMO_EPOCH } from "./timeline";
import { SMART_TEMPLATES } from "./types";
import { createWorld, worldAt } from "./world";

const { fleet, stories } = createWorld();
const REPO_ROOT = join(import.meta.dirname, "../..");

const count = <T>(items: T[], predicate: (item: T) => boolean) =>
  items.filter(predicate).length;

describe("demo fleet", () => {
  it("has 17, 6, 3 and 2 disks on atlas, styx, pip and bench plus three inventory-only", () => {
    const active = fleet.disks.filter((disk) => !disk.inventoryOnly);
    expect(count(active, (disk) => disk.host === "atlas")).toBe(17);
    expect(count(active, (disk) => disk.host === "styx")).toBe(6);
    expect(count(active, (disk) => disk.host === "pip")).toBe(3);
    expect(count(active, (disk) => disk.host === "bench")).toBe(2);
    expect(
      fleet.disks
        .filter((disk) => disk.inventoryOnly)
        .map((disk) => disk.alias),
    ).toEqual(["W1", "W2", "V2"]);
  });

  it("gives every inventory-only disk a sold, retired or dead override and a removal date", () => {
    const overrides = new Map(
      stories.seeds.overrides.map((seed) => [seed.alias, seed.stateOverride]),
    );
    for (const disk of fleet.disks.filter(
      (candidate) => candidate.inventoryOnly,
    )) {
      expect(disk.removedAt).not.toBeNull();
    }
    expect(Object.fromEntries(overrides)).toEqual({
      W1: "sold",
      W2: "retired",
      V2: "dead",
    });
  });

  it("uses unique aliases, serials, WWNs and kernel names per host", () => {
    const unique = (values: string[]) => new Set(values).size === values.length;
    expect(unique(fleet.disks.map((disk) => disk.alias))).toBe(true);
    expect(unique(fleet.disks.map((disk) => disk.serial))).toBe(true);
    expect(unique(fleet.disks.map((disk) => disk.wwn))).toBe(true);
    for (const host of fleet.hosts) {
      const onHost = fleet.disks.filter((disk) => disk.host === host.name);
      expect(unique(onHost.map((disk) => disk.kernelName))).toBe(true);
      expect(unique(onHost.map((disk) => disk.majMin))).toBe(true);
    }
  });

  it("formats serials and WWNs per vendor", () => {
    for (const disk of fleet.disks) {
      const { serial, wwn, model } = disk;
      if (disk.vendor === "seagate") {
        expect(serial).toMatch(SERIAL_FORMATS.seagate);
        expect(wwn.startsWith(WWN_PREFIXES.seagate)).toBe(true);
      } else if (model.includes("WD80EF")) {
        expect(serial).toMatch(SERIAL_FORMATS.wdRed);
        expect(wwn.startsWith(WWN_PREFIXES.wdRed)).toBe(true);
      } else if (disk.vendor === "wd" && disk.protocol === "ata") {
        expect(serial).toMatch(SERIAL_FORMATS.wdHgst);
        expect(wwn.startsWith(WWN_PREFIXES.wdHgst)).toBe(true);
      } else if (disk.vendor === "wd") {
        expect(serial).toMatch(SERIAL_FORMATS.wdNvme);
        expect(wwn.startsWith(WWN_PREFIXES.wdNvmeEui)).toBe(true);
      } else if (disk.vendor === "samsung") {
        expect(serial).toMatch(SERIAL_FORMATS.samsung);
        expect(wwn.startsWith(WWN_PREFIXES.samsung)).toBe(true);
      } else if (disk.vendor === "intel") {
        expect(serial).toMatch(SERIAL_FORMATS.intel);
        expect(wwn.startsWith(WWN_PREFIXES.intel)).toBe(true);
      } else {
        expect(serial).toMatch(SERIAL_FORMATS.crucial);
        expect(wwn.startsWith(WWN_PREFIXES.crucialEui)).toBe(true);
      }
      expect(wwn).toMatch(/^([0-9a-f]{16}|eui\.[0-9a-f]{16})$/);
    }
  });

  it("points every template at an existing fixture", () => {
    for (const path of Object.values(SMART_TEMPLATES)) {
      expect(existsSync(join(REPO_ROOT, path)), path).toBe(true);
    }
  });

  it("uses model strings the drive db resolves", () => {
    for (const disk of fleet.disks) {
      expect(lookupSpec(disk.model), disk.model).not.toBeNull();
    }
  });

  it("has inventory the inventory schema accepts", () => {
    for (const disk of fleet.disks) {
      expect(() => inventorySchema.parse(disk.inventory)).not.toThrow();
    }
  });

  it("has two shucked, pin-33-taped WD120EMAZ", () => {
    const shucked = fleet.disks.filter(
      (disk) =>
        disk.inventory.purchaseCondition === "shucked" &&
        disk.inventory.pin33Taped === true,
    );
    expect(shucked.map((disk) => disk.model)).toEqual([
      "WDC WD120EMAZ-11BLFA0",
      "WDC WD120EMAZ-11BLFA0",
    ]);
  });

  it("has exactly one warranty ending in the next month", () => {
    const soon = fleet.disks.filter((disk) => {
      const expiry = disk.inventory.warrantyExpiry;
      if (!expiry) return false;
      const daysLeft = (Date.parse(expiry) - DEMO_EPOCH.getTime()) / DAY_MS;
      return daysLeft > 0 && daysLeft <= 31;
    });
    expect(soon.map((disk) => disk.alias)).toEqual(["A17"]);
  });

  it("uses suppliers from the spec", () => {
    const suppliers = new Set(
      fleet.disks.map((disk) => disk.inventory.supplier),
    );
    expect(suppliers).toEqual(
      new Set(["Scan", "Amazon", "eBay", "Bargain Hardware"]),
    );
  });

  it("names by-id links as udev does", () => {
    expect(byIdNames(stories.disk("V1"))[0]).toMatch(
      /^ata-WDC_WD80EFZZ-68BTXN0_WD-WX/,
    );
    expect(byIdNames(stories.disk("P1"))[0]).toMatch(/^nvme-CT1000P3PSSD8_/);
  });

  it("aims for about 1500 snapshots across the fleet", () => {
    const total = Object.values(fleet.datasets)
      .flat()
      .reduce((sum, dataset) => {
        const policy = dataset.snapshots;
        return policy
          ? sum + policy.hourly + policy.daily + policy.monthly
          : sum;
      }, 0);
    expect(total).toBeGreaterThan(1300);
    expect(total).toBeLessThan(1700);
  });

  it("mirrors replicated tank datasets under vault/replica", () => {
    const tank = new Set(fleet.datasets.atlas.map((dataset) => dataset.name));
    const replicas = fleet.datasets.styx.filter((dataset) => dataset.replicaOf);
    expect(replicas.length).toBeGreaterThan(0);
    for (const replica of replicas) {
      expect(tank.has(replica.replicaOf ?? "")).toBe(true);
      expect(replica.name).toBe(`vault/replica/${replica.replicaOf}`);
    }
  });
});

describe("worldAt", () => {
  it("is deterministic", () => {
    const t = new Date("2026-09-28T12:00:00Z");
    expect(worldAt(t)).toEqual(worldAt(new Date(t)));
  });

  it("returns one entry per host", () => {
    expect(worldAt(DEMO_EPOCH).map((entry) => entry.host)).toEqual([
      "atlas",
      "styx",
      "pip",
      "bench",
    ]);
  });
});
