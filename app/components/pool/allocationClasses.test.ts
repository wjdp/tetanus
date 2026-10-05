import { describe, expect, it } from "vitest";
import { allocationClassVdevs, mainVdevFree } from "./allocationClasses";

const vdev = (
  name: string,
  role: string,
  sizeBytes: number | null,
  allocBytes: number | null,
) => ({ name, role, sizeBytes, allocBytes, children: [] });

const root = {
  ...vdev("tank", "normal", 100, 40),
  children: [
    vdev("raidz2-0", "normal", 80, 35),
    vdev("mirror-1", "special", 15, 4),
    vdev("mirror-2", "dedup", 5, 1),
    vdev("sdl", "log", 5, 0),
  ],
};

describe("allocationClassVdevs", () => {
  it("picks the special and dedup vdevs", () => {
    expect(allocationClassVdevs(root).map(({ name }) => name)).toEqual([
      "mirror-1",
      "mirror-2",
    ]);
    expect(allocationClassVdevs(null)).toEqual([]);
  });
});

describe("mainVdevFree", () => {
  it("takes the class vdevs' free space off the pool's", () => {
    expect(mainVdevFree(60, allocationClassVdevs(root))).toBe(45);
  });

  it("is unknown when a class vdev's size is", () => {
    const unsized = {
      ...vdev("mirror-1", "special", null, 4),
      role: "special" as const,
    };
    expect(mainVdevFree(60, [unsized])).toBeNull();
  });
});
