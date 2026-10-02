import { describe, expect, it } from "vitest";
import { readFixture } from "../../test/fixtures";
import { ParseError } from "./parseError";
import { parse } from "./zfs-list";

const fixture = (name: string) => readFixture(`mars/${name}`);

describe("zfs-list parser", () => {
  it("parses the zfs list -j --json-int -p -t filesystem,volume fixture", () => {
    const { data, summary } = parse(fixture("zfs-list.json"), {});
    expect(summary).toEqual({
      datasets: data.datasets.length,
      filesystems: data.datasets.length,
      volumes: 0,
    });

    const tank = data.datasets.find((d) => d.name === "tank");
    expect(tank).toMatchObject({
      name: "tank",
      pool: "tank",
      type: "filesystem",
    });
    expect(tank?.properties.used).toEqual({
      value: 74326618665936,
      source: { type: "NONE", data: "-" },
    });
    expect(tank?.properties.compression).toEqual({
      value: "lz4",
      source: { type: "LOCAL", data: "-" },
    });

    const child = data.datasets.find((d) => d.name === "tank/mpmlro9");
    expect(child?.pool).toBe("tank");
  });

  it("rejects an empty body", () => {
    expect(() => parse("", {})).toThrow(ParseError);
  });

  it("rejects invalid JSON", () => {
    expect(() => parse("not json", {})).toThrow(ParseError);
  });

  it("rejects a wrong output_version", () => {
    const body = JSON.stringify({
      output_version: { command: "zfs list", vers_major: 1, vers_minor: 0 },
      datasets: {},
    });
    expect(() => parse(body, {})).toThrow(ParseError);
  });

  it("rejects an unknown dataset type", () => {
    const body = JSON.stringify({
      output_version: { command: "zfs list", vers_major: 0, vers_minor: 1 },
      datasets: {
        tank: { name: "tank", type: "SNAPSHOT", properties: {} },
      },
    });
    expect(() => parse(body, {})).toThrow(ParseError);
  });
});
