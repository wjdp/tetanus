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
