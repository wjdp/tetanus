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
      transport: "sas",
      rotational: true,
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
      },
      {
        name: "sda9",
        path: "/dev/sda9",
        majMin: "8:9",
        sizeBytes: 8388608,
        partUuid: "d05172ff-1d51-ccc5-9229-926ce1150377",
        fsType: null,
      },
    ]);
  });

  it("excludes non-disk top-level devices such as loop", () => {
    const body = readFixture("mars/lsblk.json");
    const { data } = parse(body, {});
    expect(data.disks.some((disk) => disk.name.startsWith("loop"))).toBe(false);
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
