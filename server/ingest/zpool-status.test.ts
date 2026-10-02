import { describe, expect, it } from "vitest";
import { readFixture } from "../../test/fixtures";
import { ParseError } from "./parseError";
import { DAMAGED_FILES_LIMIT, parse } from "./zpool-status";

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

  it("parses the damaged file list, msgid and moreinfo as root", () => {
    const { data, summary } = parse(fixture("zpool-status-errlist.json"), {});
    expect(summary).toEqual({ pools: 1, vdevs: 2, disks: 0 });
    const [tfault] = data.pools;
    expect(tfault).toMatchObject({
      name: "tfault",
      errors: 1,
      damagedFiles: ["/tfault/victim"],
      msgid: "ZFS-8000-8A",
      moreinfo: "https://openzfs.github.io/openzfs-docs/msg/ZFS-8000-8A",
      removal: null,
    });
    expect(tfault?.damagedFilesError).toBeUndefined();
    expect(tfault?.scan).toMatchObject({ errors: 1, processed: 0 });
  });

  it("parses a file vdev listed both flat and nested under the root once", () => {
    const { data } = parse(fixture("zpool-status-errlist.json"), {});
    const [tfault] = data.pools;
    const root = tfault?.vdevs.find((v) => v.type === "root");
    const leaves = tfault?.vdevs.filter((v) => v.type === "file");
    expect(leaves).toHaveLength(1);
    expect(leaves?.[0]).toMatchObject({
      guid: "11428255043898652460",
      name: "/var/tmp/tfault.img",
      parentGuid: root?.guid,
      checksumErrors: 6,
    });
    expect(root?.children).toEqual([leaves?.[0]?.guid]);
  });

  it("keeps an unreadable damaged file list as an error string", () => {
    const { data } = parse(
      fixture("zpool-status-errlist-unprivileged.json"),
      {},
    );
    const [tfault] = data.pools;
    expect(tfault?.damagedFilesError).toBe("Permission denied");
    expect(tfault?.damagedFiles).toBeUndefined();
  });

  it("caps the damaged file list", () => {
    const body = fixture("zpool-status-errlist.json").replace(
      '"errlist":["/tfault/victim"]',
      `"errlist":${JSON.stringify(
        Array.from({ length: DAMAGED_FILES_LIMIT + 5 }, (_, i) => `/f${i}`),
      )}`,
    );
    const [tfault] = parse(body, {}).data.pools;
    expect(tfault?.damagedFiles).toHaveLength(DAMAGED_FILES_LIMIT);
  });

  it("parses removal_stats", () => {
    const { data } = parse(fixture("zpool-status.json"), {});
    const zeta = data.pools.find((p) => p.name === "zeta");
    expect(zeta?.removal).toEqual({
      state: "FINISHED",
      removingVdev: 0,
      startTime: 1762874276,
      endTime: 1762874490,
      toCopy: 97076903936,
      copied: 97076903936,
      mappingMemory: 3109920,
    });
    expect(data.pools.find((p) => p.name === "tank")?.removal).toBeNull();
  });

  describe("log, cache and spares", () => {
    const parsed = (name: string) => {
      const [pool] = parse(fixture(`zpool-status-${name}.json`), {}).data.pools;
      if (!pool) throw new Error("no pool");
      const named = (vdevName: string) =>
        pool.vdevs.find((v) => v.name === `/var/tmp/tspare-${vdevName}.img`);
      return { pool, named };
    };

    it("parses log, cache and available spare leaves with their role", () => {
      const { pool, named } = parsed("spare-avail");
      const root = pool.vdevs.find((v) => v.type === "root");
      expect(pool.vdevs).toHaveLength(7);
      expect(named("log")).toMatchObject({
        type: "file",
        role: "log",
        parentGuid: root?.guid,
      });
      expect(named("cache")).toMatchObject({
        type: "file",
        role: "cache",
        parentGuid: root?.guid,
      });
      expect(named("spare")).toMatchObject({
        type: "file",
        role: "spare",
        state: "AVAIL",
        spareState: "AVAIL",
        parentGuid: root?.guid,
        readErrors: 0,
        writeErrors: 0,
        checksumErrors: 0,
      });
      expect(named("a")).toMatchObject({ role: "normal", state: "ONLINE" });
      expect(named("a")?.spareState).toBeUndefined();
    });

    it("parses an offline leaf beside an available spare", () => {
      const { pool, named } = parsed("spare-offline");
      expect(pool.state).toBe("DEGRADED");
      expect(named("a")?.state).toBe("OFFLINE");
      expect(named("spare")?.spareState).toBe("AVAIL");
    });

    it("places an in-use spare under spare-N once, keeping its aux state", () => {
      const { pool, named } = parsed("spare-inuse");
      const spareGroup = pool.vdevs.find((v) => v.name === "spare-0");
      const mirror = pool.vdevs.find((v) => v.name === "mirror-0");
      expect(spareGroup).toMatchObject({
        type: "spare",
        role: "normal",
        state: "DEGRADED",
        parentGuid: mirror?.guid,
      });
      expect(
        pool.vdevs.filter((v) => v.guid === "685941043871615807"),
      ).toHaveLength(1);
      expect(named("spare")).toMatchObject({
        guid: "685941043871615807",
        type: "file",
        role: "spare",
        state: "ONLINE",
        spareState: "INUSE",
        parentGuid: spareGroup?.guid,
      });
      expect(named("a")).toMatchObject({
        state: "OFFLINE",
        parentGuid: spareGroup?.guid,
      });
      expect(spareGroup?.children).toEqual([
        named("a")?.guid,
        named("spare")?.guid,
      ]);
      const root = pool.vdevs.find((v) => v.type === "root");
      expect(root?.children).not.toContain(named("spare")?.guid);
      expect(pool.scan).toMatchObject({
        function: "RESILVER",
        state: "FINISHED",
      });
    });

    it("keeps special groups typed by class with normal-role members", () => {
      const tank = parse(fixture("zpool-status-stored-paths.json"), {}).data
        .pools[0];
      expect(tank?.vdevs.find((v) => v.name === "mirror-4")?.role).toBe(
        "special",
      );
      expect(
        tank?.vdevs.find((v) => v.name === "/dev/disk/by-vdev/M1-part1")?.role,
      ).toBe("special");
      expect(tank?.vdevs.find((v) => v.name === "raidz1-0")?.role).toBe(
        "normal",
      );
    });
  });

  describe("dRAID (synthetic JSON, no captured fixture)", () => {
    const leaf = (name: string, guid: number) => ({
      name,
      vdev_type: "disk",
      guid,
      path: name,
      class: "normal",
      state: "ONLINE",
      parent: "draid2:4d:6c:1s-0",
      read_errors: 0,
      write_errors: 0,
      checksum_errors: 0,
    });
    const body = (spareType: string) =>
      JSON.stringify({
        output_version: { command: "zpool status", vers_major: 0 },
        pools: {
          tdraid: {
            name: "tdraid",
            state: "ONLINE",
            pool_guid: 100,
            vdevs: {
              tdraid: {
                name: "tdraid",
                vdev_type: "root",
                guid: 100,
                class: "normal",
                state: "ONLINE",
                read_errors: 0,
                write_errors: 0,
                checksum_errors: 0,
              },
              "draid2:4d:6c:1s-0": {
                name: "draid2:4d:6c:1s-0",
                vdev_type: "draid",
                guid: 101,
                class: "normal",
                state: "ONLINE",
                parent: "tdraid",
                read_errors: 0,
                write_errors: 0,
                checksum_errors: 0,
              },
              ...Object.fromEntries(
                [1, 2, 3, 4, 5, 6].map((n) => [
                  `/dev/sd${n}`,
                  leaf(`/dev/sd${n}`, 110 + n),
                ]),
              ),
              "draid2-0-0": {
                name: "draid2-0-0",
                vdev_type: spareType,
                guid: 120,
                class: "spare",
                state: "AVAIL",
              },
            },
          },
        },
      });

    it.each(["dspare", "dist-spare"])(
      "parses a draid2 group and an available %s distributed spare",
      (spareType) => {
        const [pool] = parse(body(spareType), {}).data.pools;
        const group = pool?.vdevs.find((v) => v.guid === "101");
        expect(group).toMatchObject({ type: "draid2", role: "normal" });
        expect(group?.children).toHaveLength(6);
        expect(pool?.vdevs.find((v) => v.guid === "120")).toMatchObject({
          type: "dspare",
          role: "spare",
          state: "AVAIL",
          spareState: "AVAIL",
          parentGuid: "100",
          readErrors: 0,
        });
      },
    );
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
