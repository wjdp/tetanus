import { describe, expect, it } from "vitest";
import { readFixture } from "../../test/fixtures";
import { ParseError } from "./parseError";
import { parse } from "./zpool-status";

const fixture = (name: string) => readFixture(`mars/${name}`);

describe("zpool-status parser", () => {
  it("parses the -Ppvs --json-flat-vdevs fixture the collector sends", () => {
    const { data, summary } = parse(
      fixture("zpool-status-stored-paths.json"),
      {},
    );
    expect(summary).toEqual({ pools: 2, vdevs: 25, disks: 17 });
    expect(data.pools.map((p) => p.name)).toEqual(["tank", "zeta"]);

    const tank = data.pools[0];
    expect(tank.guid).toBe("4620770592528249368");
    expect(tank.state).toBe("ONLINE");
    expect(tank.scan).toMatchObject({
      function: "SCRUB",
      state: "FINISHED",
      startTime: 1789255441,
      endTime: 1789325257,
    });

    const root = tank.vdevs.find((v) => v.type === "root");
    expect(root).toMatchObject({ name: "tank", parentGuid: null });

    const disk = tank.vdevs.find(
      (v) => v.name === "/dev/disk/by-vdev/K1-part1",
    );
    expect(disk).toMatchObject({
      guid: "615499781187199551",
      type: "disk",
      path: "/dev/disk/by-vdev/K1-part1",
      devid: "scsi-35000cca5f853b4e6-part1",
      state: "ONLINE",
      readErrors: 0,
      writeErrors: 0,
      checksumErrors: 0,
      slowIos: 0,
    });

    // raidz parity comes from the "raidz1-0" style vdev name; the raw JSON
    // carries no separate parity field.
    const raidzGroup = tank.vdevs.find((v) => v.name === "raidz1-0");
    expect(raidzGroup?.type).toBe("raidz1");
    expect(raidzGroup?.parentGuid).toBe(root?.guid);
    expect(disk?.parentGuid).toBe(raidzGroup?.guid);
    expect(raidzGroup?.children).toContain(disk?.guid);

    // "special" is a top-level group class (mirror-4, class=special): the
    // group vdev's type comes from class, not from vdev_type "mirror". Its
    // members keep vdev_type "disk" and stay parented to it.
    const specialGroup = tank.vdevs.find((v) => v.name === "mirror-4");
    expect(specialGroup).toMatchObject({
      type: "special",
      parentGuid: root?.guid,
    });
    const specialMember = tank.vdevs.find(
      (v) => v.name === "/dev/disk/by-vdev/M1-part1",
    );
    expect(specialMember).toMatchObject({
      type: "disk",
      parentGuid: specialGroup?.guid,
    });
  });

  it("parses the -L (resolved symlink) variant, defaulting stripped leaf fields", () => {
    const { data } = parse(fixture("zpool-status.json"), {});
    const tank = data.pools.find((p) => p.name === "tank");
    const leaf = tank?.vdevs.find((v) => v.name === "/dev/sda1");
    // -L drops guid/path/devid/state from leaf vdevs (see docs/005 findings);
    // the parser falls back to the device path as guid, "disk" as type and
    // "UNKNOWN" as state rather than rejecting the whole payload.
    expect(leaf).toMatchObject({
      guid: "/dev/sda1",
      type: "disk",
      state: "UNKNOWN",
    });
    const group = tank?.vdevs.find((v) => v.name === "raidz1-0");
    expect(group?.guid).toBe("11092505927246116873");
    expect(leaf?.parentGuid).toBe(group?.guid);
  });

  it("parses the -g (guid-named) variant, defaulting unrecoverable raidz parity", () => {
    const { data } = parse(fixture("zpool-status-guids.json"), {});
    const tank = data.pools.find((p) => p.name === "tank");
    const disk = tank?.vdevs.find((v) => v.guid === "615499781187199551");
    expect(disk?.type).toBe("disk");
    expect(disk?.path).toBe("/dev/disk/by-vdev/K1-part1");
    // -g replaces the raidz group's name with its guid, so the "raidzN-x"
    // parity marker is gone; the parser falls back to raidz1 rather than
    // throwing (see the comment in deriveType).
    const group = tank?.vdevs.find((v) => v.guid === "11092505927246116873");
    expect(group?.type).toBe("raidz1");
  });

  it("rejects the nested vdev tree shape (no --json-flat-vdevs)", () => {
    expect(() => parse(fixture("zpool-status-nested.json"), {})).toThrow(
      ParseError,
    );
  });

  it("rejects an empty body", () => {
    expect(() => parse("", {})).toThrow(ParseError);
  });

  it("rejects a wrong output_version", () => {
    const body = JSON.stringify({
      output_version: { command: "zpool status", vers_major: 1, vers_minor: 0 },
      pools: {},
    });
    expect(() => parse(body, {})).toThrow(ParseError);
  });

  it("rejects invalid JSON", () => {
    expect(() => parse("not json", {})).toThrow(ParseError);
  });
});
