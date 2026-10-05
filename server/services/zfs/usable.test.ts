import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "~~/server/database/client";
import { dataset, pool, poolReading } from "~~/server/database/schema";
import { parse as parseZfsList } from "~~/server/ingest/zfs-list";
import { upsertHostByName } from "~~/server/services/hosts";
import { flushDb } from "~~/test/db";
import { readFixture } from "~~/test/fixtures";
import { observeZfsList } from "./datasets";
import { getPool } from "./queries";

const T0 = new Date("2026-09-28T17:00:00Z");
const MINUTE_MS = 60_000;

const minutesAfter = (minutes: number) =>
  new Date(T0.getTime() + minutes * MINUTE_MS);

function seedTank() {
  const hostId = upsertHostByName("mars", T0).id;
  const tank = db
    .insert(pool)
    .values({
      hostId,
      guid: "4620770592528249368",
      name: "tank",
      state: "ONLINE",
      firstSeenAt: T0,
      lastSeenAt: T0,
    })
    .returning()
    .get();
  return { hostId, tank };
}

const observeMars = (hostId: number, at: Date) =>
  observeZfsList(
    hostId,
    parseZfsList(readFixture("mars/zfs-list.json"), {}).data,
    at,
  );

const tankRoot = () => {
  const row = db.select().from(dataset).where(eq(dataset.name, "tank")).get();
  if (!row) throw new Error("tank not stored");
  return row;
};

const addReading = (poolId: number, at: Date) =>
  db
    .insert(poolReading)
    .values({ poolId, at, allocBytes: 1, freeBytes: 1, state: "ONLINE" })
    .returning()
    .get();

beforeEach(() => {
  flushDb();
});

describe("pool usable space", () => {
  it("is the root dataset's used and available", () => {
    const { hostId, tank } = seedTank();
    observeMars(hostId, T0);
    const root = tankRoot();

    expect(getPool(tank.id).usable).toEqual({
      used: root.used,
      available: root.available,
      at: T0,
    });
  });

  it("falls back to none once zfs list lags zpool status by over a cadence", () => {
    const { hostId, tank } = seedTank();
    observeMars(hostId, T0);

    db.update(pool)
      .set({ lastSeenAt: minutesAfter(10) })
      .where(eq(pool.id, tank.id))
      .run();
    expect(getPool(tank.id).usable).not.toBeNull();

    db.update(pool)
      .set({ lastSeenAt: minutesAfter(11) })
      .where(eq(pool.id, tank.id))
      .run();
    expect(getPool(tank.id).usable).toBeNull();
  });

  it("is none without a root dataset", () => {
    const { tank } = seedTank();
    expect(getPool(tank.id).usable).toBeNull();
  });

  it("adds the root's figures to the same run's pool reading only", () => {
    const { hostId, tank } = seedTank();
    const earlier = addReading(tank.id, minutesAfter(-30));
    const sameRun = addReading(tank.id, minutesAfter(-1));
    observeMars(hostId, T0);
    const root = tankRoot();

    const reading = (id: number) =>
      db.select().from(poolReading).where(eq(poolReading.id, id)).get();
    expect(reading(sameRun.id)).toMatchObject({
      usedBytes: root.used,
      availableBytes: root.available,
    });
    expect(reading(earlier.id)).toMatchObject({
      usedBytes: null,
      availableBytes: null,
    });
  });
});
