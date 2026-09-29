import { describe, expect, it } from "vitest";
import {
  type DiskUsage,
  isMounted,
  UNKNOWN_USAGE,
  usageColour,
  usageDetail,
  usageShort,
} from "./usage";

const zfs: DiskUsage = {
  kind: "zfs",
  fsTypes: ["zfs_member"],
  mounts: [],
  system: false,
};
const empty: DiskUsage = {
  kind: "empty",
  fsTypes: [],
  mounts: [],
  system: false,
};
const unmounted: DiskUsage = {
  kind: "filesystem",
  fsTypes: ["LVM2_member", "ext4"],
  mounts: [],
  system: false,
};
const system: DiskUsage = {
  kind: "filesystem",
  fsTypes: ["crypto_LUKS", "ext4", "vfat"],
  mounts: [
    { fsType: "ext4", path: "/", via: ["luks", "lvm"] },
    { fsType: "vfat", path: "/boot/efi", via: [] },
    { fsType: "ext4", path: "/home", via: ["luks", "lvm"] },
    { fsType: "ext4", path: "/srv", via: [] },
  ],
  system: true,
};

describe("isMounted", () => {
  it("is true only for a filesystem with mounts", () => {
    expect(isMounted(system)).toBe(true);
    expect(isMounted(unmounted)).toBe(false);
    expect(isMounted(zfs)).toBe(false);
    expect(isMounted(UNKNOWN_USAGE)).toBe(false);
  });
});

describe("usageDetail", () => {
  it("names the pool for zfs", () => {
    expect(usageDetail(zfs, "tank")).toBe("tank");
  });

  it("flags a zfs label without a pool", () => {
    expect(usageDetail(zfs, null)).toBe("zfs label, no pool");
  });

  it("groups mounts by filesystem and mapper chain in first-seen order", () => {
    expect(usageDetail(system, null)).toBe(
      "ext4 on /, /home (luks, lvm), vfat on /boot/efi, ext4 on /srv",
    );
  });

  it("describes an unmounted filesystem as data", () => {
    expect(usageDetail(unmounted, null)).toBe("has LVM2_member, ext4 data");
  });

  it("describes empty and unknown", () => {
    expect(usageDetail(empty, null)).toBe("empty");
    expect(usageDetail(UNKNOWN_USAGE, null)).toBe("usage unknown");
  });
});

describe("usageShort", () => {
  it("uses the pool name, else zfs", () => {
    expect(usageShort(zfs, "tank")).toBe("tank");
    expect(usageShort(zfs, null)).toBe("zfs");
  });

  it("uses the first mount when mounted", () => {
    expect(usageShort(system, null)).toBe("ext4 /");
  });

  it("lists filesystem types when unmounted", () => {
    expect(usageShort(unmounted, null)).toBe("LVM2_member, ext4");
  });

  it("abbreviates empty and unknown", () => {
    expect(usageShort(empty, null)).toBe("empty");
    expect(usageShort(UNKNOWN_USAGE, null)).toBe("?");
  });
});

describe("usageColour", () => {
  it("colours each kind", () => {
    expect(usageColour("zfs")).toBe("info");
    expect(usageColour("filesystem")).toBe("neutral");
    expect(usageColour("empty")).toBe("neutral");
    expect(usageColour("unknown")).toBe("warning");
  });
});
