import { describe, expect, it } from "vitest";
import { readFixture } from "../../test/fixtures";
import { ParseError } from "./parseError";
import { parse } from "./vdev-id-conf";

describe("vdev-id-conf parser", () => {
  it("reads aliases, normalising by-id paths to basenames", () => {
    const body = readFixture("mars/vdev-id-conf.txt");
    const { data, summary } = parse(body, {});
    expect(data.aliases).toHaveLength(23);
    expect(summary).toEqual({ aliases: 23 });
    expect(data.aliases[0]).toEqual({
      alias: "Z1",
      target: "scsi-SATA_Samsung_SSD_850_H8NPAO4SU23238R",
    });
    expect(data.aliases.find((a) => a.alias === "K2")).toEqual({
      alias: "K2",
      target: "wwn-0x5000ccad5ed6ee0c",
    });
    expect(data.ignoredDirectives).toBe(0);
  });

  it("normalises a full /dev/disk/by-id path to its basename", () => {
    const body = "alias K1 /dev/disk/by-id/wwn-0x5000cca5f853b4e6\n";
    const { data } = parse(body, {});
    expect(data.aliases).toEqual([
      { alias: "K1", target: "wwn-0x5000cca5f853b4e6" },
    ]);
  });

  it("ignores comments, blank lines and other directives", () => {
    const body = [
      "# vdev_id.conf",
      "",
      "multipath yes",
      "topology sas_switch",
      "phys_per_port 4",
      "slot bay",
      "channel 85:00.0 1 A",
      "enclosure_symlinks yes",
      "alias K1 wwn-0x5000cca5f853b4e6",
    ].join("\n");
    const { data } = parse(body, {});
    expect(data.aliases).toEqual([
      { alias: "K1", target: "wwn-0x5000cca5f853b4e6" },
    ]);
    expect(data.ignoredDirectives).toBe(6);
  });

  it("rejects a duplicate alias", () => {
    const body = ["alias K1 wwn-0x1", "alias K1 wwn-0x2"].join("\n");
    expect(() => parse(body, {})).toThrow(ParseError);
  });

  it("rejects an alias line missing a target", () => {
    expect(() => parse("alias K1", {})).toThrow(ParseError);
  });

  it("rejects an empty body", () => {
    expect(() => parse("", {})).toThrow(ParseError);
    expect(() => parse("   ", {})).toThrow(ParseError);
  });
});
