import { eq, sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { db } from "~~/server/database/client";
import * as schema from "~~/server/database/schema";
import { seed, tick } from "~~/server/demo/seed";
import { DEMO_EPOCH, HOUR_MS } from "~~/server/demo/timeline";
import { addManualEntry } from "~~/server/services/diary";
import { listDisks } from "~~/server/services/disks";
import { dumpDatabase } from "~~/test/db";
import { discardCapture, rollBackCapture, startCapture } from "./capture";

const NOW = new Date(DEMO_EPOCH.getTime() + 2 * HOUR_MS);

function triggerCount() {
  return (
    db.get<{ n: number }>(
      sql`SELECT count(*) AS n FROM sqlite_master WHERE type = 'trigger'`,
    )?.n ?? 0
  );
}

beforeAll(async () => {
  await seed(NOW, { replay: "short" });
}, 120_000);

describe("capture", () => {
  it("rolls back inserts, updates and cascading deletes exactly", async () => {
    const before = dumpDatabase();
    startCapture();
    startCapture();

    await tick(new Date(NOW.getTime() + HOUR_MS));
    const [first] = await listDisks(NOW);
    addManualEntry({
      subjectType: "disk",
      subjectId: first.id,
      title: "Captured note",
      at: NOW,
    });
    db.update(schema.host).set({ notes: "edited" }).run();
    db.delete(schema.disk).where(eq(schema.disk.id, first.id)).run();

    expect(dumpDatabase()).not.toEqual(before);
    expect(rollBackCapture()).toBeGreaterThan(0);
    expect(dumpDatabase()).toEqual(before);
    expect(triggerCount()).toBe(0);
  }, 60_000);

  it("is a no-op with nothing captured", () => {
    const before = dumpDatabase();
    expect(rollBackCapture()).toBe(0);
    expect(dumpDatabase()).toEqual(before);
  });

  it("discards the log without undoing anything", () => {
    startCapture();
    db.update(schema.host).set({ notes: "kept" }).run();
    discardCapture();
    const after = dumpDatabase();

    expect(triggerCount()).toBe(0);
    expect(rollBackCapture()).toBe(0);
    expect(dumpDatabase()).toEqual(after);
    expect(
      db.select({ notes: schema.host.notes }).from(schema.host).all(),
    ).toContainEqual({
      notes: "kept",
    });
  });
});
