import { describe, expect, it } from "vitest";
import { NAVIGATION, SETTINGS_NAVIGATION } from "./navigation";

describe("NAVIGATION", () => {
  it("lists the eight top-level pages in sidebar order", () => {
    expect(NAVIGATION.map(({ label, to }) => [label, to])).toEqual([
      ["Topology", "/"],
      ["Faults", "/faults"],
      ["Hosts", "/hosts"],
      ["Disks", "/disks"],
      ["ZFS", "/zfs"],
      ["Replications", "/replications"],
      ["Diary", "/diary"],
      ["Settings", "/settings"],
    ]);
  });

  it("badges Faults, Hosts, Disks, ZFS and Replications with their status counts", () => {
    expect(NAVIGATION.find(({ to }) => to === "/faults")).toMatchObject({
      icon: "i-lucide-siren",
      badge: "faults",
    });
    expect(
      NAVIGATION.flatMap(({ to, badge }) => (badge ? [[to, badge]] : [])),
    ).toEqual([
      ["/faults", "faults"],
      ["/hosts", "hosts"],
      ["/disks", "disks"],
      ["/zfs", "pools"],
      ["/replications", "replications"],
    ]);
  });
});

describe("SETTINGS_NAVIGATION", () => {
  it("lists General, Alerts and Import", () => {
    expect(SETTINGS_NAVIGATION.map(({ label, to }) => [label, to])).toEqual([
      ["General", "/settings"],
      ["Alerts", "/settings/alerts"],
      ["Import", "/settings/import"],
    ]);
  });
});
