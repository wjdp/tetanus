import { describe, expect, it } from "vitest";
import { readFixture } from "../../test/fixtures";
import { ParseError } from "./parseError";
import { parse } from "./zpool-list";

const fixture = (name: string) => readFixture(`mars/${name}`);

describe("zpool-list parser", () => {
  it("parses the zpool list -j --json-int -pv fixture", () => {
    const { data, summary } = parse(fixture("zpool-list.json"), {});
    expect(summary).toEqual({ pools: 2 });
    expect(data.pools.map((p) => p.name)).toEqual(["tank", "zeta"]);

    const tank = data.pools[0];
    // pool_guid is a bare JSON number above 2^53 in the fixture; JSON.parse
    // would silently round it, so it is requoted at the text level first.
    expect(tank.guid).toBe("4620770592528249368");
    expect(tank.properties.size).toEqual({
      value: 174457276596224,
      source: { type: "NONE", data: "-" },
    });
    expect(tank.properties.health).toEqual({
      value: "ONLINE",
      source: { type: "NONE", data: "-" },
    });
    expect(tank.properties.dedupratio).toEqual({
      value: "1.00",
      source: { type: "NONE", data: "-" },
    });
    // "-" placeholders (checkpoint, expandsize, altroot) stay as the string
    // ZFS reports, not coerced to a number.
    expect(tank.properties.checkpoint.value).toBe("-");
  });

  it("flattens -v vdevs, including allocation-class groups, skipping guid-less ones", () => {
    const { data } = parse(fixture("zpool-list.json"), {});
    const [tank, zeta] = data.pools;

    expect(tank.vdevs.map((vdev) => vdev.name)).toEqual([
      "raidz1-0",
      ...["K1", "K2", "K3", "raidz1-1", "K4", "K5", "K6"],
      ...["raidz1-2", "L1", "L2", "L4", "raidz1-3", "Q1", "Q4", "Q3"],
      ...["mirror-4", "M1", "M2", "M3"],
    ]);
    expect(tank.vdevs[0]).toMatchObject({
      guid: "11092505927246116873",
      properties: { fragmentation: { value: 10 } },
    });
    expect(zeta.vdevs.map((vdev) => vdev.name)).toEqual([
      "mirror-1",
      "Z3",
      "Z4",
    ]);
  });

  it("rejects an empty body", () => {
    expect(() => parse("", {})).toThrow(ParseError);
  });

  it("rejects invalid JSON", () => {
    expect(() => parse("not json", {})).toThrow(ParseError);
  });

  it("rejects a wrong output_version", () => {
    const body = JSON.stringify({
      output_version: { command: "zpool list", vers_major: 1, vers_minor: 0 },
      pools: {},
    });
    expect(() => parse(body, {})).toThrow(ParseError);
  });

  it("rejects a property that is missing a source", () => {
    const body = JSON.stringify({
      output_version: { command: "zpool list", vers_major: 0, vers_minor: 1 },
      pools: {
        tank: {
          name: "tank",
          pool_guid: 123,
          properties: { size: { value: 1 } },
        },
      },
    });
    expect(() => parse(body, {})).toThrow(ParseError);
  });
});
