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
      used: 1795024,
      referenced: 385706464,
      written: 385706464,
      creation: 1704843446,
    });
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
