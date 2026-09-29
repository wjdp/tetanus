import { describe, expect, it } from "vitest";
import { vdevTypeVocabulary } from "./vdevType";

describe("vdevTypeVocabulary", () => {
  it.each([
    ["raidz1", "i-lucide-layers"],
    ["raidz2", "i-lucide-layers"],
    ["raidz3", "i-lucide-layers"],
    ["mirror", "i-lucide-copy"],
    ["disk", "i-lucide-rows-2"],
    ["file", "i-lucide-rows-2"],
    ["special", "i-lucide-sparkles"],
    ["log", "i-lucide-pen-line"],
    ["cache", "i-lucide-zap"],
    ["spare", "i-lucide-life-buoy"],
    ["dedup", "i-lucide-git-merge"],
    ["indirect", "i-lucide-corner-down-right"],
  ])("gives %s the %s icon", (type, icon) => {
    expect(vdevTypeVocabulary(type)?.icon).toBe(icon);
  });

  it("labels single-device top-level vdevs as stripe", () => {
    expect(vdevTypeVocabulary("disk")?.label).toBe("stripe");
  });

  it.each(["draid2", "toString"])(
    "returns null for unknown type %s",
    (type) => {
      expect(vdevTypeVocabulary(type)).toBeNull();
    },
  );
});
