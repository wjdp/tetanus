import { describe, expect, it } from "vitest";
import { readFixture } from "../../test/fixtures";
import { ParseError } from "./parseError";
import { parse } from "./zpool-events";

describe("zpool-events parser", () => {
  it("parses the mars capture (OpenZFS 2.4, tab-separated headers)", () => {
    const fixture = readFixture("mars/zpool-events.txt");
    const { data, summary } = parse(fixture, {});
    expect(data.events.length).toBeGreaterThan(0);
    expect(summary.events).toBe(data.events.length);
    expect(summary.classes).toBeGreaterThan(0);
    expect(summary.firstEid).toBe(data.events[0]?.eid);
    expect(summary.lastEid).toBe(data.events[data.events.length - 1]?.eid);

    const first = data.events[0];
    expect(first?.eid).toBe(0x980);
    expect(first?.class).toBe("sysevent.fs.zfs.history_event");
    expect(first?.pool).toBe("zeta");
    expect(first?.poolGuid).toBe(BigInt("0x44ea8dbb345d3bcc").toString());
    expect(first?.fields.history_dsname).toBe(
      "zeta/z62a@autosnap_2026-09-28_20:45:03_frequently",
    );
    // history_internal_str = " " decodes to a literal single space, not empty.
    expect(first?.fields.history_internal_str).toBe(" ");
    // built from the `time` field (seconds+nanoseconds), not the local header timestamp
    expect(first?.at).toBe("2026-09-28T20:45:03.619Z");
  });

  it("parses the Q2 failure capture (OpenZFS 2.2, embedded nvlists and empty values)", () => {
    const fixture = readFixture("events/q2-failure-2025-05.txt");
    const { data, summary } = parse(fixture, {});
    expect(data.events).toHaveLength(4);
    expect(summary.events).toBe(4);

    const delay = data.events[0];
    expect(delay?.eid).toBe(0x7e271);
    expect(delay?.class).toBe("ereport.fs.zfs.delay");
    expect(delay?.pool).toBe("tank");
    expect(delay?.poolGuid).toBe(BigInt("0x4020465f3c37b218").toString());
    expect(delay?.vdevGuid).toBe(BigInt("0x89187303056733f5").toString());
    // embedded nvlist flattened with a dot path, values still hex-decoded
    expect(delay?.fields["detector.scheme"]).toBe("zfs");
    expect(delay?.fields["detector.pool"]).toBe(
      BigInt("0x4020465f3c37b218").toString(),
    );
    expect(delay?.fields["detector.vdev"]).toBe(
      BigInt("0x89187303056733f5").toString(),
    );
    expect(delay?.fields.detector).toBeUndefined();
    // empty values decode to an empty string, not undefined/omitted
    expect(delay?.fields.vdev_spare_paths).toBe("");
    expect(delay?.fields.vdev_spare_guids).toBe("");
    // time = 0x.. 0x.. builds `at`, not the header text
    expect(delay?.at).not.toBe(delay?.header);

    // resource.fs.zfs.removed has no `eid` field at all in this capture.
    const removed = data.events[2];
    expect(removed?.class).toBe("resource.fs.zfs.removed");
    expect(removed?.eid).toBeNull();
    // quoted string with a trailing "(0x..)" annotation unquotes to just the string
    expect(removed?.fields.vdev_state).toBe("REMOVED");
  });

  it("decodes a hex array field to an array of decimal strings", () => {
    const body = [
      "Sep 28 2026 16:00:18.929432743 ereport.fs.zfs.io",
      '        class = "ereport.fs.zfs.io"',
      '        pool = "tank"',
      "        vdev_spare_guids = 0x1 0x2a",
      "        eid = 0x5",
      "",
    ].join("\n");
    const { data } = parse(body, {});
    expect(data.events[0]?.fields.vdev_spare_guids).toEqual(["1", "42"]);
  });

  it("throws ParseError for an empty body", () => {
    expect(() => parse("", {})).toThrow(ParseError);
  });

  it("throws ParseError for an unrecognisable header", () => {
    expect(() => parse("not a header\n        eid = 0x1\n", {})).toThrow(
      ParseError,
    );
  });
});
