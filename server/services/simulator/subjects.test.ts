import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "~~/server/database/client";
import { disk } from "~~/server/database/schema";
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
