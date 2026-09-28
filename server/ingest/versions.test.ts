import { describe, expect, it } from "vitest";
import { ParseError } from "./parseError";
import { parse } from "./versions";

describe("versions parser", () => {
  it("reads KEY=value lines", () => {
    const body = [
      "zfs=zfs-2.4.1-1",
      "zpool=zfs-kmod-2.4.1-1",
      "kernel=6.8.0-45-generic",
      "smartctl=smartctl 7.4 2023-08-01 r5530",
      "os=Ubuntu 24.04.1 LTS",
    ].join("\n");
    expect(parse(body, {})).toEqual({
      data: {
        zfs: "zfs-2.4.1-1",
        zpool: "zfs-kmod-2.4.1-1",
        kernel: "6.8.0-45-generic",
        smartctl: "smartctl 7.4 2023-08-01 r5530",
        os: "Ubuntu 24.04.1 LTS",
      },
      summary: { keys: 5 },
    });
  });

  it("ignores blank and comment lines and CRLF endings", () => {
    const body = "# collected by tetanus\r\n\r\n  kernel = 6.8.0  \r\n";
    expect(parse(body, {}).data).toEqual({ kernel: "6.8.0" });
  });

  it("keeps everything after the first equals sign and strips quotes", () => {
    expect(parse(`os="Debian GNU/Linux 12"\nflags=a=b`, {}).data).toEqual({
      os: "Debian GNU/Linux 12",
      flags: "a=b",
    });
  });

  it("accepts an empty value", () => {
    expect(parse("zfs=", {}).data).toEqual({ zfs: "" });
  });

  it("returns no keys for an empty body", () => {
    expect(parse("", {})).toEqual({ data: {}, summary: { keys: 0 } });
  });

  it.each(["kernel 6.8.0", "=6.8.0"])("rejects %j", (line) => {
    expect(() => parse(line, {})).toThrow(ParseError);
  });
});
