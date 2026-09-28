import { describe, expect, it } from "vitest";
import { readFixture } from "../../test/fixtures";
import { ParseError } from "./parseError";
import { parse } from "./udev";

describe("udev parser", () => {
  it("reads properties, symlinks, aliases and by-id entries", () => {
    const body = readFixture("mars/udev/b8-0.txt");
    const { data, summary } = parse(body, { device: "b8:0" });

    expect(data.device).toBe("b8:0");
    expect(data.symlinks).toContain("disk/by-vdev/K1");
    expect(data.aliases).toEqual(["K1"]);
    expect(data.byId.sort()).toEqual(
      ["scsi-35000cca5f853b4e6", "wwn-0x5000cca5f853b4e6"].sort(),
    );
    expect(data.properties.SCSI_MODEL).toBe("WDC_WD120EMAZ-11");
    expect(data.properties.ID_VDEV).toBe("K1");
    expect(summary).toEqual({
      properties: Object.keys(data.properties).length,
      symlinks: data.symlinks.length,
      aliases: 1,
    });
  });

  it("decodes \\x hex escapes only in _ENC keys", () => {
    const body = readFixture("mars/udev/b8-0.txt");
    const { data } = parse(body, {});
    expect(data.properties.SCSI_VENDOR_ENC).toBe("ATA     ");
    expect(data.properties.SCSI_VENDOR).toBe("ATA");
  });

  it("has no aliases when there is no by-vdev symlink", () => {
    const body = readFixture("mars/udev/b65-0.txt");
    const { data } = parse(body, {});
    expect(data.aliases).toEqual([]);
    expect(data.byId.length).toBeGreaterThan(0);
  });

  it("defaults device to null without meta.device", () => {
    const body = readFixture("mars/udev/b65-0.txt");
    const { data } = parse(body, {});
    expect(data.device).toBeNull();
  });

  it("rejects an empty body", () => {
    expect(() => parse("", {})).toThrow(ParseError);
    expect(() => parse("   ", {})).toThrow(ParseError);
  });

  it("rejects an E line with no key", () => {
    expect(() => parse("E:novalue", {})).toThrow(ParseError);
  });
});
