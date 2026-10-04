import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "~~/server/database/client";
import { dataset, disk, pool, replication } from "~~/server/database/schema";
import { upsertHostByName } from "~~/server/services/hosts";
import { flushDb } from "~~/test/db";
import { loadSubject } from "./subjects";

const t0 = new Date("2026-09-01T10:00:00Z");

let diskId: number;

beforeEach(() => {
  flushDb();
  const mars = upsertHostByName("mars", t0);
  diskId = db
    .insert(disk)
    .values({ alias: "K2", lastSeenAt: t0, lastSeenHostId: mars.id })
    .returning()
    .get().id;
});

function update(values: Partial<typeof disk.$inferInsert>) {
  db.update(disk).set(values).where(eq(disk.id, diskId)).run();
}

describe("loadSubject", () => {
  it("loads a disk in service with its host", () => {
    expect(loadSubject("disk", diskId)).toMatchObject({
      type: "disk",
      disk: { id: diskId },
      host: { name: "mars" },
    });
  });

  it("skips a history disk", () => {
    update({ stateOverride: "dead" });
    expect(loadSubject("disk", diskId)).toBeUndefined();
  });

  it("skips a disposed disk", () => {
    update({ disposal: { kind: "rma", on: "2026-09-02" } });
    expect(loadSubject("disk", diskId)).toBeUndefined();
  });
});

describe("loadSubject for a replication", () => {
  let poolId: number;
  let replicationId: number;

  beforeEach(() => {
    const styx = upsertHostByName("styx", t0);
    poolId = db
      .insert(pool)
      .values({
        hostId: styx.id,
        guid: "vault-guid",
        name: "vault",
        state: "ONLINE",
        firstSeenAt: t0,
        lastSeenAt: t0,
      })
      .returning()
      .get().id;
    const targetDatasetId = db
      .insert(dataset)
      .values({
        poolId,
        name: "vault/replica/tank/photos",
        type: "filesystem",
        used: 0,
        referenced: 0,
        available: 0,
        creation: t0,
        firstSeenAt: t0,
        lastSeenAt: t0,
      })
      .returning()
      .get().id;
    replicationId = db
      .insert(replication)
      .values({
        targetDatasetId,
        direction: "received",
        firstSeenAt: t0,
        lastSeenAt: t0,
      })
      .returning()
      .get().id;
  });

  it("loads it with the target host, which collects it", () => {
    expect(loadSubject("replication", replicationId)).toMatchObject({
      type: "replication",
      replication: { id: replicationId },
      host: { name: "styx" },
    });
  });

  it("skips an archived replication", () => {
    db.update(replication)
      .set({ archivedAt: t0 })
      .where(eq(replication.id, replicationId))
      .run();
    expect(loadSubject("replication", replicationId)).toBeUndefined();
  });

  it("skips a replication into an archived pool", () => {
    db.update(pool).set({ archivedAt: t0 }).where(eq(pool.id, poolId)).run();
    expect(loadSubject("replication", replicationId)).toBeUndefined();
  });
});
