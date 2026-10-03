import { describe, expect, it } from "vitest";
import { readFixture } from "../../test/fixtures";
import { ParseError } from "./parseError";
import { parse } from "./zfs-snapshots";

const fixture = (name: string) => readFixture(`mars/${name}`);

describe("zfs-snapshots parser", () => {
  it("parses the truncated fixture (real count kept in zfs-snapshots.count)", () => {
    const { data, summary } = parse(fixture("zfs-snapshots.json"), {});
    // The fixture is truncated to 200 rows for repo size; the real count on
    // mars was 1827 (test/fixtures/mars/zfs-snapshots.count).
    expect(data.snapshots).toHaveLength(200);
    expect(summary).toEqual({ snapshots: 200 });

    const first = data.snapshots.find(
      (s) =>
        s.name === "tank/yoh6kfw@syncoid_oth10_2024-01-09:23:37:26-GMT00:00",
    );
    expect(first).toEqual({
      name: "tank/yoh6kfw@syncoid_oth10_2024-01-09:23:37:26-GMT00:00",
      dataset: "tank/yoh6kfw",
      snapshot: "syncoid_oth10_2024-01-09:23:37:26-GMT00:00",
      guid: "2085090045664847989",
      used: 1795024,
      referenced: 385706464,
      written: 385706464,
      creation: 1704843446,
    });
  });

  it("keeps a guid beyond 2^53 exact as a decimal string", () => {
    const body = `{
      "output_version": {"command": "zfs list", "vers_major": 0, "vers_minor": 1},
      "datasets": {
        "tank/a@s1": {
          "name": "tank/a@s1",
          "properties": {
            "guid": {"value": 17747342225710399424, "source": {"type": "NONE", "data": "-"}},
            "used": {"value": 10},
            "referenced": {"value": 20},
            "written": {"value": 5},
            "creation": {"value": 1700000000}
          }
        }
      }
    }`;
    expect(parse(body, {}).data.snapshots[0].guid).toBe("17747342225710399424");
  });

  it("reads the string form zfs prints without --json-int", () => {
    const body = JSON.stringify({
      output_version: { command: "zfs list", vers_major: 0, vers_minor: 1 },
      datasets: {
        "tank/a@autosnap_2025-10-01_00:00:07_monthly": {
          name: "tank/a@autosnap_2025-10-01_00:00:07_monthly",
          type: "SNAPSHOT",
          pool: "tank",
          createtxg: "5632348",
          dataset: "tank/a",
          snapshot_name: "autosnap_2025-10-01_00:00:07_monthly",
          properties: {
            guid: {
              value: "18101820395123456789",
              source: { type: "NONE", data: "-" },
            },
            used: { value: "1024", source: { type: "NONE", data: "-" } },
            referenced: { value: "2048", source: { type: "NONE", data: "-" } },
            written: { value: "512", source: { type: "NONE", data: "-" } },
            creation: {
              value: "1759276807",
              source: { type: "NONE", data: "-" },
            },
          },
        },
      },
    });
    expect(parse(body, {}).data.snapshots[0]).toMatchObject({
      guid: "18101820395123456789",
      used: 1024,
      referenced: 2048,
      written: 512,
      creation: 1759276807,
    });
  });

  it.each([
    ["numeric", "9223372036854775807"],
    ["string", '"9223372036854775807"'],
  ])("treats a %s guid saturated at INT64_MAX as null", (_, guid) => {
    const body = `{
      "output_version": {"command": "zfs list", "vers_major": 0, "vers_minor": 1},
      "datasets": {
        "tank/a@s1": {
          "name": "tank/a@s1",
          "properties": {
            "guid": {"value": ${guid}},
            "used": {"value": 10},
            "referenced": {"value": 20},
            "written": {"value": 5},
            "creation": {"value": 1700000000}
          }
        }
      }
    }`;
    expect(parse(body, {}).data.snapshots[0].guid).toBeNull();
  });

  it("treats a missing guid as null", () => {
    const withoutGuid = fixture("zfs-snapshots.json").replace(
      /"guid":\s*\{[^}]*\{[^}]*\}\s*\},?/g,
      "",
    );
    const { data } = parse(withoutGuid, {});
    expect(data.snapshots.length).toBeGreaterThan(0);
    expect(data.snapshots.every((s) => s.guid === null)).toBe(true);
  });

  it("rejects a non-numeric guid", () => {
    const body = JSON.stringify({
      output_version: { command: "zfs list", vers_major: 0, vers_minor: 1 },
      datasets: {
        "tank/a@s1": {
          name: "tank/a@s1",
          properties: {
            guid: { value: "abc" },
            used: { value: 0 },
            referenced: { value: 0 },
            written: { value: 0 },
            creation: { value: 0 },
          },
        },
      },
    });
    expect(() => parse(body, {})).toThrow(ParseError);
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

  it("accepts a numeric string for a property value", () => {
    const body = JSON.stringify({
      output_version: { command: "zfs list", vers_major: 0, vers_minor: 1 },
      datasets: {
        "tank/a@s1": {
          name: "tank/a@s1",
          properties: {
            used: { value: "10" },
            referenced: { value: "20" },
            written: { value: "5" },
            creation: { value: "1700000000" },
          },
        },
      },
    });
    expect(parse(body, {}).data.snapshots[0]).toMatchObject({
      used: 10,
      referenced: 20,
      written: 5,
      creation: 1700000000,
    });
  });

  it("rejects a non-numeric property value", () => {
    const body = JSON.stringify({
      output_version: { command: "zfs list", vers_major: 0, vers_minor: 1 },
      datasets: {
        "tank/a@s1": {
          name: "tank/a@s1",
          properties: {
            used: { value: "not-a-number" },
            referenced: { value: 0 },
            written: { value: 0 },
            creation: { value: 0 },
          },
        },
      },
    });
    expect(() => parse(body, {})).toThrow(ParseError);
  });
});
