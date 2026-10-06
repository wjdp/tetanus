import { describe, expect, it } from "vitest";
import {
  isNavigationActive,
  NAVIGATION,
  SETTINGS_NAVIGATION,
} from "./navigation";

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

describe("isNavigationActive", () => {
  const activeLabels = (path: string) =>
    NAVIGATION.filter((entry) => isNavigationActive(entry, path)).map(
      ({ label }) => label,
    );

  it.each([
    ["/", "Topology"],
    ["/faults", "Faults"],
    ["/hosts/add", "Hosts"],
    ["/disks/12", "Disks"],
    ["/zfs/nas1/tank", "ZFS"],
    ["/zfs/nas1/tank/media", "ZFS"],
    ["/replications/2", "Replications"],
    ["/settings/alerts", "Settings"],
  ])("marks only the section owning %s", (path, label) => {
    expect(activeLabels(path)).toEqual([label]);
  });

  it("does not match a section by bare prefix", () => {
    expect(activeLabels("/disksomething")).toEqual([]);
  });
});

describe("SETTINGS_NAVIGATION", () => {
  it("lists General, Alerts, Import and Database", () => {
    expect(SETTINGS_NAVIGATION.map(({ label, to }) => [label, to])).toEqual([
      ["General", "/settings"],
      ["Alerts", "/settings/alerts"],
      ["Import", "/settings/import"],
      ["Database", "/settings/database"],
    ]);
  });
});
