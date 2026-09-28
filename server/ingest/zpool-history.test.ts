import { describe, expect, it } from "vitest";
import { readFixture } from "../../test/fixtures";
import { ParseError } from "./parseError";
import { parse } from "./zpool-history";

describe("zpool-history parser", () => {
  const fixture = readFixture("mars/zpool-history.txt");

  it("parses the mars capture", () => {
    const { data, summary } = parse(fixture, {});
    expect(data.entries.length).toBeGreaterThan(0);
    expect(summary.entries).toBe(data.entries.length);
    // tail -n 500 cut this capture before any "History for '<pool>':" header, so every
    // entry's pool is null and the distinct-pool count is 0.
    expect(summary.pools).toBe(0);
    expect(data.entries.every((entry) => entry.pool === null)).toBe(true);
  });

  it("discards an orphaned continuation at the start of a tail-cut file", () => {
    const body = [
      "            zeta/z62a@autosnap_2026-09-27_15:00:04_hourly",
      "2026-09-28.16:00:09 zfs destroy zeta/z62a@autosnap_2026-09-27_15:00:04_hourly [user 0 (root) on mars:linux]",
    ].join("\n");
    const { data } = parse(body, {});
    expect(data.entries).toHaveLength(1);
    const first = data.entries[0];
    expect(first?.text).toBe(
      "zfs destroy zeta/z62a@autosnap_2026-09-27_15:00:04_hourly",
    );
    expect(first?.user).toEqual({ uid: 0, name: "root" });
    expect(first?.host).toBe("mars");
  });

  it("reads an internal txg event with pool from a header", () => {
    const body = [
      "History for 'zeta':",
      "2026-09-28.16:00:09 [txg:85190584] destroy zeta/utn@autosnap_2026-09-27_15:00:04_hourly (104206)   [on mars]",
    ].join("\n");
    const { data } = parse(body, {});
    expect(data.entries).toEqual([
      {
        pool: "zeta",
        at: "2026-09-28T16:00:09.000Z",
        timestamp: "2026-09-28.16:00:09",
        internal: true,
        txg: 85190584,
        text: "destroy zeta/utn@autosnap_2026-09-27_15:00:04_hourly (104206)",
        user: null,
        host: "mars",
      },
    ]);
  });

  it("reads a plain zfs command entry", () => {
    const body =
      "2026-09-28.16:00:09 zfs destroy zeta/z62a@autosnap_2026-09-27_15:00:04_hourly [user 0 (root) on mars:linux]";
    const { data } = parse(body, {});
    expect(data.entries).toEqual([
      {
        pool: null,
        at: "2026-09-28T16:00:09.000Z",
        timestamp: "2026-09-28.16:00:09",
        internal: false,
        txg: null,
        text: "zfs destroy zeta/z62a@autosnap_2026-09-27_15:00:04_hourly",
        user: { uid: 0, name: "root" },
        host: "mars",
      },
    ]);
  });

  it("folds an ioctl entry's continuation lines into its text and picks up the trailing user", () => {
    const body = [
      "2026-09-28.16:00:09 (14ms) ioctl destroy_snaps",
      "    input:",
      "        snaps:",
      "            zeta/z62a@autosnap_2026-09-28_14:00:03_frequently",
      " [user 0 (root) on mars:linux]",
    ].join("\n");
    const { data } = parse(body, {});
    expect(data.entries).toHaveLength(1);
    const entry = data.entries[0];
    expect(entry?.internal).toBe(false);
    expect(entry?.txg).toBeNull();
    expect(entry?.user).toEqual({ uid: 0, name: "root" });
    expect(entry?.host).toBe("mars");
    expect(entry?.text).toBe(
      [
        "(14ms) ioctl destroy_snaps",
        "    input:",
        "        snaps:",
        "            zeta/z62a@autosnap_2026-09-28_14:00:03_frequently",
      ].join("\n"),
    );
  });

  it("resets pool to null once a header is followed by no pool, and switches pools across headers", () => {
    const body = [
      "History for 'alpha':",
      "2026-09-28.16:00:09 zfs destroy alpha/a [user 0 (root) on mars:linux]",
      "History for 'beta':",
      "2026-09-28.16:00:10 zfs destroy beta/b [user 0 (root) on mars:linux]",
    ].join("\n");
    const { data, summary } = parse(body, {});
    expect(data.entries.map((e) => e.pool)).toEqual(["alpha", "beta"]);
    expect(summary.pools).toBe(2);
  });

  it("throws ParseError for an empty body", () => {
    expect(() => parse("", {})).toThrow(ParseError);
  });

  it("throws ParseError when there are no recognisable entries", () => {
    expect(() => parse("not a history line\n", {})).toThrow(ParseError);
  });
});
