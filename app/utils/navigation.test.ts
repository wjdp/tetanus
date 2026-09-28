import { describe, expect, it } from "vitest";
import { NAVIGATION } from "./navigation";

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
