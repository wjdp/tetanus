import { beforeEach, describe, expect, it } from "vitest";
import { db } from "~~/server/database/client";
import { dataset, pool } from "~~/server/database/schema";
import { upsertHostByName } from "~~/server/services/hosts";
import { flushDb } from "~~/test/db";
import { legacyPath, poolPaths, resolveZfsPath } from "./paths";

const T0 = new Date("2026-09-28T17:00:00Z");
const T1 = new Date("2026-10-01T17:00:00Z");

function insertPool(
  hostId: number,
  guid: string,
  values: Partial<typeof pool.$inferInsert> = {},
) {
  return db
    .insert(pool)
    .values({
      hostId,
      guid,
      name: "tank",
      state: "ONLINE",
      firstSeenAt: T0,
      lastSeenAt: T0,
      ...values,
    })
    .returning()
    .get();
}

function insertDataset(poolId: number, name: string) {
  return db
    .insert(dataset)
    .values({
      poolId,
      name,
      type: "filesystem",
      used: 0,
      referenced: 0,
      available: 0,
      creation: T0,
      firstSeenAt: T0,
      lastSeenAt: T0,
    })
    .returning()
    .get();
}

function seed() {
  const hostId = upsertHostByName("nas1", T0).id;
  const archived = insertPool(hostId, "1000000000000111111", {
    archivedAt: T1,
  });
  const live = insertPool(hostId, "2000000000000222222", { lastSeenAt: T1 });
  const archivedRoot = insertDataset(archived.id, "tank");
  const liveRoot = insertDataset(live.id, "tank");
  const media = insertDataset(live.id, "tank/my media");
  const archivedMedia = insertDataset(archived.id, "tank/my media");
  return {
    hostId,
    archived,
    live,
    archivedRoot,
    liveRoot,
    media,
    archivedMedia,
  };
}

beforeEach(() => {
  flushDb();
});

describe("poolPaths", () => {
  it("gives the live pool the bare name and the archived one a guid suffix", () => {
    const { archived, live } = seed();
    const paths = poolPaths();
    expect(paths.get(live.id)).toBe("/zfs/nas1/tank");
    expect(paths.get(archived.id)).toBe("/zfs/nas1/tank~111111");
  });
});

describe("resolveZfsPath", () => {
  it("resolves the live pool and the archived pool", () => {
    const { archived, live } = seed();
    expect(resolveZfsPath("nas1", ["tank"])).toEqual({
      kind: "pool",
      id: live.id,
    });
    expect(resolveZfsPath("nas1", ["tank~111111"])).toEqual({
      kind: "pool",
      id: archived.id,
    });
  });

  it("resolves root and nested datasets in the right pool", () => {
    const { liveRoot, archivedMedia } = seed();
    expect(resolveZfsPath("nas1", ["tank", "~root"])).toEqual({
      kind: "dataset",
      id: liveRoot.id,
    });
    expect(resolveZfsPath("nas1", ["tank~111111", "my media"])).toEqual({
      kind: "dataset",
      id: archivedMedia.id,
    });
  });

  it("follows a pool moved to another host", () => {
    const { live } = seed();
    const nas2 = upsertHostByName("nas2", T1).id;
    db.update(pool).set({ hostId: nas2 }).run();
    expect(poolPaths().get(live.id)).toBe("/zfs/nas2/tank");
    expect(resolveZfsPath("nas2", ["tank"])).toEqual({
      kind: "pool",
      id: live.id,
    });
  });

  it("throws not found for an unknown host, pool or dataset", () => {
    seed();
    expect(() => resolveZfsPath("nas9", ["tank"])).toThrow(/not found/);
    expect(() => resolveZfsPath("nas1", ["zeta"])).toThrow(/No pool/);
    expect(() => resolveZfsPath("nas1", ["tank", "nope"])).toThrow(/No pool/);
  });
});

describe("legacyPath", () => {
  it("maps old ids to the current paths", () => {
    const { hostId, archived, media } = seed();
    expect(legacyPath("hosts", hostId)).toBe("/hosts/nas1");
    expect(legacyPath("zfs", archived.id)).toBe("/zfs/nas1/tank~111111");
    expect(legacyPath("datasets", media.id)).toBe("/zfs/nas1/tank/my%20media");
    expect(legacyPath("zfs", 999)).toBeNull();
  });
});
