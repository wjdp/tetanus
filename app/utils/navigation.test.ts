import { describe, expect, it } from "vitest";
import { NAVIGATION, SETTINGS_NAVIGATION } from "./navigation";

describe("NAVIGATION", () => {
  it("lists the five top-level pages in sidebar order", () => {
    expect(NAVIGATION.map(({ label, to }) => [label, to])).toEqual([
      ["Topology", "/"],
      ["Disks", "/disks"],
      ["ZFS", "/zfs"],
      ["Diary", "/diary"],
      ["Settings", "/settings"],
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
