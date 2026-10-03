import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "~~/server/database/client";
import { collectorRun, host, pool } from "~~/server/database/schema";
import { upsertHostByName } from "~~/server/services/hosts";
import {
  poolPresence,
  poolPresenceContext,
} from "~~/server/services/poolPresence";
import { flushDb } from "~~/test/db";

const t0 = new Date("2026-09-01T10:00:00Z");
const MINUTE_MS = 60 * 1000;
const DAY_MS = 24 * 60 * MINUTE_MS;
const at = (offsetMs: number) => new Date(t0.getTime() + offsetMs);

function recordRun(hostId: number, source: string, receivedAt: Date) {
  db.insert(collectorRun)
    .values({ hostId, source, receivedAt, ok: true, bytes: 0 })
    .run();
}

const recordStatusRun = (hostId: number, receivedAt: Date) =>
  recordRun(hostId, "zpool-status", receivedAt);

function insertPool(hostId: number, lastSeenAt: Date) {
  return db
    .insert(pool)
    .values({
      hostId,
      guid: "123",
      name: "vault",
      state: "ONLINE",
      firstSeenAt: lastSeenAt,
      lastSeenAt,
    })
    .returning()
    .get();
}

const presenceAt = (row: typeof pool.$inferSelect, now: Date) =>
  poolPresence(row, poolPresenceContext(now, undefined, {}));

beforeEach(() => {
  flushDb();
});

describe("poolPresence", () => {
  it("is unscanned before any zpool-status run", () => {
    const mars = upsertHostByName("mars", t0);
    recordRun(mars.id, "lsblk", t0);
    expect(presenceAt(insertPool(mars.id, t0), t0)).toBe("unscanned");
  });

  it("is present when seen in the latest zpool-status run", () => {
    const mars = upsertHostByName("mars", t0);
    const vault = insertPool(mars.id, t0);
    recordStatusRun(mars.id, t0);

    expect(presenceAt(vault, at(MINUTE_MS))).toBe("present");
  });

  it("is missing when a later zpool-status run did not see it", () => {
    const mars = upsertHostByName("mars", t0);
    const vault = insertPool(mars.id, t0);
    recordStatusRun(mars.id, at(10 * MINUTE_MS));

    expect(presenceAt(vault, at(11 * MINUTE_MS))).toBe("missing");
  });

  it("defers to the host when it has gone silent", () => {
    const mars = upsertHostByName("mars", t0);
    const vault = insertPool(mars.id, t0);
    recordStatusRun(mars.id, at(MINUTE_MS));

    expect(presenceAt(vault, at(DAY_MS))).toBe("host-silent");
  });

  it("is not missing on an offline intermittent host", () => {
    const mars = upsertHostByName("mars", t0);
    db.update(host)
      .set({ intermittent: true })
      .where(eq(host.id, mars.id))
      .run();
    const vault = insertPool(mars.id, t0);
    recordStatusRun(mars.id, at(MINUTE_MS));

    expect(presenceAt(vault, at(DAY_MS))).toBe("host-offline");
  });
});
