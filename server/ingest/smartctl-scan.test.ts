import { describe, expect, it } from "vitest";
import { readFixture } from "../../test/fixtures";
import { ParseError } from "./parseError";
import { parse } from "./smartctl-scan";

describe("smartctl-scan parser", () => {
  it("reads devices from a scan", () => {
    const body = readFixture("mars/smartctl-scan.json");
    const { data, summary } = parse(body, {});
    expect(data.smartctl).toEqual({ version: "7.5", exitStatus: 0 });
    expect(data.devices).toHaveLength(20);
    expect(data.devices[0]).toEqual({
      name: "/dev/sda",
      type: "scsi",
      protocol: "SCSI",
      infoName: "/dev/sda",
    });
    expect(data.devices.at(-1)).toEqual({
      name: "/dev/nvme0",
      type: "nvme",
      protocol: "NVMe",
      infoName: "/dev/nvme0",
    });
    expect(summary).toEqual({ devices: 20 });
  });

  it("rejects an empty body", () => {
    expect(() => parse("", {})).toThrow(ParseError);
    expect(() => parse("   ", {})).toThrow(ParseError);
  });

  it("rejects invalid JSON", () => {
    expect(() => parse("not json", {})).toThrow(ParseError);
  });

  it("rejects JSON missing smartctl.version", () => {
    expect(() => parse(JSON.stringify({ devices: [] }), {})).toThrow(
      ParseError,
    );
  });
});
