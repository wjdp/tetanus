import { describe, expect, it } from "vitest";
import { NAVIGATION, SETTINGS_NAVIGATION } from "./navigation";

describe("NAVIGATION", () => {
  it("lists the six top-level pages in sidebar order", () => {
    expect(NAVIGATION.map(({ label, to }) => [label, to])).toEqual([
      ["Topology", "/"],
      ["Faults", "/faults"],
      ["Disks", "/disks"],
      ["ZFS", "/zfs"],
      ["Diary", "/diary"],
      ["Settings", "/settings"],
    ]);
  });

  it("badges Faults, Disks and ZFS with their status counts", () => {
    expect(NAVIGATION.find(({ to }) => to === "/faults")).toMatchObject({
      icon: "i-lucide-siren",
      badge: "faults",
    });
    expect(
      NAVIGATION.flatMap(({ to, badge }) => (badge ? [[to, badge]] : [])),
    ).toEqual([
      ["/faults", "faults"],
      ["/disks", "disks"],
      ["/zfs", "pools"],
    ]);
  });
});

describe("SETTINGS_NAVIGATION", () => {
  it("lists General, Hosts, Alerts and Import", () => {
    expect(SETTINGS_NAVIGATION.map(({ label, to }) => [label, to])).toEqual([
      ["General", "/settings"],
      ["Hosts", "/settings/hosts"],
      ["Alerts", "/settings/alerts"],
      ["Import", "/settings/import"],
    ]);
  });
});
