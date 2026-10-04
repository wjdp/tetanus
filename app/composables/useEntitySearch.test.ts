// @vitest-environment nuxt
import { registerEndpoint } from "@nuxt/test-utils/runtime";
import { describe, expect, it } from "vitest";
import {
  diskSearchEntry,
  hostSearchEntry,
  poolSearchEntry,
  useEntitySearch,
} from "./useEntitySearch";

registerEndpoint("/api/hosts", () => [
  { id: 1, name: "mars", displayName: "Mars NAS" },
]);
registerEndpoint("/api/disks", () => [
  { id: 3, alias: "K2", model: "WDC WD80EFAX", serial: "VK0ABC" },
]);
registerEndpoint("/api/pools", () => [
  { id: 7, name: "tank", host: { id: 1, name: "mars", displayName: null } },
]);

describe("diskSearchEntry", () => {
  it("labels by alias, model and serial and links to the disk page", () => {
    expect(
      diskSearchEntry({ id: 3, alias: "K2", model: "WDC", serial: "VK0ABC" }),
    ).toEqual({
      id: "disk-3",
      label: "K2 · WDC · VK0ABC",
      icon: "i-lucide-hard-drive",
      to: "/disks/3",
    });
  });

  it("badges a disposed disk with its disposal", () => {
    const disposed = {
      id: 3,
      alias: "K2",
      model: "WDC",
      serial: "VK0ABC",
      disposal: { kind: "rma", on: "2026-10-02" },
      replacedByDiskId: 9,
    } as const;

    expect(diskSearchEntry(disposed, () => "K7").badge).toMatchObject({
      label: "RMA · replaced by K7",
      icon: "i-lucide-package-open",
      color: "neutral",
    });
    expect(
      diskSearchEntry({ ...disposed, disposal: null }).badge,
    ).toBeUndefined();
  });

  it("drops missing parts and falls back to the id", () => {
    expect(
      diskSearchEntry({ id: 4, alias: null, model: "WDC", serial: "S1" }).label,
    ).toBe("WDC · S1");
    expect(
      diskSearchEntry({ id: 5, alias: null, model: null, serial: null }).label,
    ).toBe("Disk 5");
  });
});

describe("hostSearchEntry", () => {
  it("labels by display name and name, linking to the host", () => {
    const entry = hostSearchEntry({ id: 2, name: "pip", displayName: null });

    expect(entry.label).toBe("pip");
    expect(entry.to).toBe("/hosts/2");
    expect(entry.icon).toBe("i-lucide-server");
  });
});

describe("poolSearchEntry", () => {
  it("labels by name and host display name, linking to the pool", () => {
    const entry = poolSearchEntry({
      id: 7,
      name: "tank",
      host: { name: "mars", displayName: "Mars NAS" },
    });

    expect(entry.label).toBe("tank · Mars NAS");
    expect(entry.to).toBe("/zfs/7");
    expect(entry.icon).toBe("i-lucide-database");
  });
});

describe("useEntitySearch", () => {
  it("loads hosts, disks and pools on demand", async () => {
    const { hosts, disks, pools, load } = useEntitySearch();
    expect(disks.value).toBeNull();

    await load();

    expect(disks.value?.map((entry) => entry.label)).toEqual([
      "K2 · WDC WD80EFAX · VK0ABC",
    ]);
    expect(pools.value?.map((entry) => entry.label)).toEqual(["tank · mars"]);
    expect(hosts.value?.map((entry) => entry.label)).toEqual([
      "Mars NAS · mars",
    ]);
  });
});
