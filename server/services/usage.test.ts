import { describe, expect, it } from "vitest";
import { parse } from "~~/server/ingest/lsblk";
import { inferUsage, resolvePurpose } from "~~/server/services/usage";
import { readFixture } from "~~/test/fixtures";

function usageByName(fixture: string) {
  const { disks } = parse(readFixture(fixture), {}).data;
  return new Map(disks.map((disk) => [disk.name, inferUsage(disk)]));
}

describe("inferUsage on LVM on LUKS", () => {
  const usage = usageByName("synthetic-lsblk/lvm-on-luks.json");

  it("resolves mapper chains down to mounted filesystems", () => {
    expect(usage.get("nvme0n1")).toEqual({
      kind: "filesystem",
      fsTypes: ["LVM2_member", "crypto_LUKS", "ext4", "swap", "vfat"],
      mounts: [
        { fsType: "vfat", path: "/boot/efi", via: [] },
        { fsType: "ext4", path: "/boot", via: [] },
        { fsType: "ext4", path: "/", via: ["luks", "lvm"] },
        { fsType: "swap", path: "[SWAP]", via: ["luks", "lvm"] },
      ],
      system: true,
    });
  });

  it("reads a whole-disk filesystem", () => {
    expect(usage.get("sda")).toEqual({
      kind: "filesystem",
      fsTypes: ["ext4"],
      mounts: [{ fsType: "ext4", path: "/srv", via: [] }],
      system: false,
    });
  });

  it("reads the single mountpoint column of older lsblk", () => {
    expect(usage.get("sdb")).toMatchObject({
      kind: "filesystem",
      mounts: [{ fsType: "xfs", path: "/mnt/scratch", via: [] }],
    });
  });

  it("is unknown without a mount column", () => {
    expect(usage.get("sdc")).toEqual({
      kind: "unknown",
      fsTypes: ["ext4"],
      mounts: [],
      system: false,
    });
  });
});

describe("inferUsage on mars", () => {
  const usage = usageByName("mars/lsblk.json");

  it("is a system filesystem for the boot disk", () => {
    expect(usage.get("nvme0n1")).toMatchObject({
      kind: "filesystem",
      system: true,
    });
  });

  it("is zfs for pool members", () => {
    expect(usage.get("sda")).toEqual({
      kind: "zfs",
      fsTypes: ["zfs_member"],
      mounts: [],
      system: false,
    });
  });

  it("is empty with no filesystem anywhere", () => {
    expect(usage.get("zram0")?.kind).toBe("empty");
  });
});

describe("resolvePurpose", () => {
  it("prefers the inventory purpose", () => {
    expect(resolvePurpose({ purpose: "system" }, { system: false })).toEqual({
      purpose: "system",
      purposeInferred: false,
    });
  });

  it("infers system from usage", () => {
    expect(resolvePurpose({}, { system: true })).toEqual({
      purpose: "system",
      purposeInferred: true,
    });
  });

  it("is null without a choice or system usage", () => {
    expect(resolvePurpose({}, { system: false })).toEqual({
      purpose: null,
      purposeInferred: false,
    });
    expect(resolvePurpose({}, null)).toEqual({
      purpose: null,
      purposeInferred: false,
    });
  });
});
