import { describe, expect, it } from "vitest";
import {
  datasetPath,
  hostPath,
  parseZfsPath,
  poolPath,
  poolSlugs,
  type SluggablePool,
} from "./entityPaths";

const pool = (overrides: Partial<SluggablePool>): SluggablePool => ({
  id: 1,
  hostId: 1,
  name: "tank",
  guid: "4620770592528249368",
  archivedAt: null,
  lastSeenAt: new Date("2026-09-01T00:00:00Z"),
  ...overrides,
});

describe("hostPath and poolPath", () => {
  it("encode each name as one segment", () => {
    expect(hostPath("nas1")).toBe("/hosts/nas1");
    expect(poolPath("nas 1", "tank~249368")).toBe("/zfs/nas%201/tank~249368");
  });
});

describe("datasetPath", () => {
  it("drops the pool segment of the dataset name", () => {
    expect(datasetPath("/zfs/nas1/tank", "tank/media/photos")).toBe(
      "/zfs/nas1/tank/media/photos",
    );
  });

  it("marks the root dataset with ~root", () => {
    expect(datasetPath("/zfs/nas1/tank", "tank")).toBe("/zfs/nas1/tank/~root");
  });

  it("keeps a dataset literally called root apart from the root dataset", () => {
    expect(datasetPath("/zfs/nas1/tank", "tank/root")).toBe(
      "/zfs/nas1/tank/root",
    );
  });

  it("encodes spaces and colons within segments", () => {
    expect(datasetPath("/zfs/nas1/tank", "tank/my files/a:b")).toBe(
      "/zfs/nas1/tank/my%20files/a%3Ab",
    );
  });
});

describe("poolSlugs", () => {
  it("gives a lone pool its bare name", () => {
    expect(poolSlugs([pool({})]).get(1)).toBe("tank");
  });

  it("gives the bare name to the live pool and a guid suffix to an archived one", () => {
    const slugs = poolSlugs([
      pool({ id: 1, guid: "111111111111111111", archivedAt: new Date() }),
      pool({ id: 2, guid: "222222222222249368" }),
    ]);
    expect(slugs.get(2)).toBe("tank");
    expect(slugs.get(1)).toBe("tank~111111");
  });

  it("prefers the most recently seen of two live pools", () => {
    const slugs = poolSlugs([
      pool({ id: 1, guid: "100000000000000001" }),
      pool({
        id: 2,
        guid: "200000000000000002",
        lastSeenAt: new Date("2026-10-01T00:00:00Z"),
      }),
    ]);
    expect(slugs.get(2)).toBe("tank");
    expect(slugs.get(1)).toBe("tank~000001");
  });

  it("falls back to the whole guid when short suffixes collide", () => {
    const slugs = poolSlugs([
      pool({ id: 1, guid: "900000000000000000" }),
      pool({ id: 2, guid: "100000000000123456", archivedAt: new Date() }),
      pool({ id: 3, guid: "200000000000123456", archivedAt: new Date() }),
    ]);
    expect(slugs.get(2)).toBe("tank~100000000000123456");
    expect(slugs.get(3)).toBe("tank~200000000000123456");
  });

  it("does not disambiguate pools of the same name on different hosts", () => {
    const slugs = poolSlugs([
      pool({ id: 1, hostId: 1 }),
      pool({ id: 2, hostId: 2, guid: "1" }),
    ]);
    expect(slugs.get(1)).toBe("tank");
    expect(slugs.get(2)).toBe("tank");
  });
});

describe("parseZfsPath", () => {
  it("reads a pool", () => {
    expect(parseZfsPath(["tank"])).toEqual({
      poolSlug: "tank",
      datasetName: null,
    });
  });

  it("reads the root dataset", () => {
    expect(parseZfsPath(["tank~249368", "~root"])).toEqual({
      poolSlug: "tank~249368",
      datasetName: "tank",
    });
  });

  it("reads a nested dataset under a suffixed pool", () => {
    expect(parseZfsPath(["tank~249368", "media", "my files"])).toEqual({
      poolSlug: "tank~249368",
      datasetName: "tank/media/my files",
    });
  });

  it("returns null without a pool", () => {
    expect(parseZfsPath([])).toBeNull();
  });
});
