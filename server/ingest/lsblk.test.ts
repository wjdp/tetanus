import { describe, expect, it } from "vitest";
import { readFixture } from "../../test/fixtures";
import { parse } from "./lsblk";
import { ParseError } from "./parseError";

describe("lsblk parser", () => {
  it("reads disks and partitions, dropping loop/zram devices", () => {
    const body = readFixture("mars/lsblk.json");
    const { data, summary } = parse(body, {});
    expect(data.disks).toHaveLength(21);
    expect(summary).toEqual({ disks: 21, partitions: 41 });

    const sda = data.disks.find((disk) => disk.name === "sda");
    expect(sda).toMatchObject({
      path: "/dev/sda",
      majMin: "8:0",
      sizeBytes: 12000138625024,
      model: "WDC WD120EMAZ-11",
      serial: "0UTY8HTE",
      wwn: "5000cca5f853b4e6",
      link: "sas",
      rotational: true,
      zoned: "none",
      logicalBlockSize: 512,
      physicalBlockSize: 4096,
      partitionTableType: "gpt",
    });
    expect(sda?.partitions).toEqual([
      {
        name: "sda1",
        path: "/dev/sda1",
        majMin: "8:1",
        sizeBytes: 12000128139264,
        partUuid: "5e2557d0-93da-b346-903f-a913c8e11433",
        fsType: "zfs_member",
        mountPoints: [],
        children: [],
      },
      {
        name: "sda9",
        path: "/dev/sda9",
        majMin: "8:9",
        sizeBytes: 8388608,
        partUuid: "d05172ff-1d51-ccc5-9229-926ce1150377",
        fsType: null,
        mountPoints: [],
        children: [],
      },
    ]);
  });

  it("reads the mount points of the system disk through LVM", () => {
    const { data } = parse(readFixture("mars/lsblk.json"), {});
    const nvme = data.disks.find((disk) => disk.name === "nvme0n1");
    expect(nvme).toMatchObject({
      fsType: null,
      mountPoints: [],
      children: [],
    });
    const p3 = nvme?.partitions.find((part) => part.name === "nvme0n1p3");
    expect(p3?.fsType).toBe("LVM2_member");
    expect(p3?.mountPoints).toEqual([]);
    expect(p3?.children).toEqual([
      {
        name: "ubuntu--vg-ubuntu--lv",
        path: "/dev/mapper/ubuntu--vg-ubuntu--lv",
        type: "lvm",
        fsType: "ext4",
        mountPoints: ["/"],
        children: [],
      },
      {
        name: "ubuntu--vg-ubuntu--swap",
        path: "/dev/mapper/ubuntu--vg-ubuntu--swap",
        type: "lvm",
        fsType: "swap",
        mountPoints: ["[SWAP]"],
        children: [],
      },
    ]);
  });

  it("excludes non-disk top-level devices such as loop", () => {
    const body = readFixture("mars/lsblk.json");
    const { data } = parse(body, {});
    expect(data.disks.some((disk) => disk.name.startsWith("loop"))).toBe(false);
  });

  describe("synthetic lvm-on-luks fixture", () => {
    const { data, summary } = parse(
      readFixture("synthetic-lsblk/lvm-on-luks.json"),
      {},
    );
    const diskNamed = (name: string) =>
      data.disks.find((disk) => disk.name === name);

    it("excludes loop devices", () => {
      expect(data.disks.map((disk) => disk.name)).toEqual([
        "nvme0n1",
        "sda",
        "sdb",
        "sdc",
      ]);
      expect(summary).toEqual({ disks: 4, partitions: 5 });
    });

    it("reads mounted partitions and drops null mountpoints", () => {
      const nvme = diskNamed("nvme0n1");
      expect(nvme).toMatchObject({
        fsType: null,
        mountPoints: [],
        children: [],
      });
      expect(
        nvme?.partitions.map(({ name, fsType, mountPoints }) => ({
          name,
          fsType,
          mountPoints,
        })),
      ).toEqual([
        { name: "nvme0n1p1", fsType: "vfat", mountPoints: ["/boot/efi"] },
        { name: "nvme0n1p2", fsType: "ext4", mountPoints: ["/boot"] },
        { name: "nvme0n1p3", fsType: "crypto_LUKS", mountPoints: [] },
      ]);
    });

    it("follows the LUKS then LVM chain recursively", () => {
      const p3 = diskNamed("nvme0n1")?.partitions.find(
        (part) => part.name === "nvme0n1p3",
      );
      expect(p3?.children).toEqual([
        {
          name: "luks-3a7f2c1e-9b8d-4e6f-a5c4-b3d2e1f0a9b8",
          path: "/dev/mapper/luks-3a7f2c1e-9b8d-4e6f-a5c4-b3d2e1f0a9b8",
          type: "crypt",
          fsType: "LVM2_member",
          mountPoints: [],
          children: [
            {
              name: "vg0-root",
              path: "/dev/mapper/vg0-root",
              type: "lvm",
              fsType: "ext4",
              mountPoints: ["/"],
              children: [],
            },
            {
              name: "vg0-swap",
              path: "/dev/mapper/vg0-swap",
              type: "lvm",
              fsType: "swap",
              mountPoints: ["[SWAP]"],
              children: [],
            },
          ],
        },
      ]);
    });

    it("records a whole-disk filesystem on the disk itself", () => {
      expect(diskNamed("sda")).toMatchObject({
        partitionTableType: null,
        fsType: "ext4",
        mountPoints: ["/srv"],
        children: [],
        partitions: [],
      });
    });

    it("falls back to the singular mountpoint column", () => {
      const sdb = diskNamed("sdb");
      expect(sdb?.mountPoints).toEqual([]);
      expect(sdb?.partitions[0]).toMatchObject({
        fsType: "xfs",
        mountPoints: ["/mnt/scratch"],
      });
    });

    it("reports mount points as unknown when neither column is present", () => {
      const sdc = diskNamed("sdc");
      expect(sdc?.mountPoints).toBeNull();
      expect(sdc?.partitions[0]).toMatchObject({
        fsType: "ext4",
        mountPoints: null,
      });
    });
  });

  it("reads zoned model and sector sizes, missing columns as unknown", () => {
    const body = JSON.stringify({
      blockdevices: [
        {
          name: "sda",
          type: "disk",
          size: 1,
          "maj:min": "8:0",
          path: "/dev/sda",
          zoned: "host-managed",
          "log-sec": 512,
          "phy-sec": 4096,
        },
        {
          name: "sdb",
          type: "disk",
          size: 1,
          "maj:min": "8:16",
          path: "/dev/sdb",
        },
      ],
    });
    const { data } = parse(body, {});
    expect(data.disks[0]).toMatchObject({
      zoned: "host-managed",
      logicalBlockSize: 512,
      physicalBlockSize: 4096,
    });
    expect(data.disks[1]).toMatchObject({
      zoned: null,
      logicalBlockSize: null,
      physicalBlockSize: null,
    });
  });

  it("rejects an empty body", () => {
    expect(() => parse("", {})).toThrow(ParseError);
    expect(() => parse("  ", {})).toThrow(ParseError);
  });

  it("rejects invalid JSON", () => {
    expect(() => parse("not json", {})).toThrow(ParseError);
  });

  it("rejects JSON missing blockdevices", () => {
    expect(() => parse("{}", {})).toThrow(ParseError);
  });
});
