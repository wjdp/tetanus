import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "~~/server/database/client";
import { disk } from "~~/server/database/schema";
import { backfillAtaSsdAttributesOnce } from "~~/server/services/ataSsdAttributesBackfill";
import { recordIngest } from "~~/server/services/ingest";
import { getSettings } from "~~/server/services/settings";
import { flushDb } from "~~/test/db";
import { readFixture } from "~~/test/fixtures";

const t0 = new Date("2026-09-01T10:00:00Z");
const SDN = readFixture("mars/smartctl/xall-sdn-auto.json");
const SDN_SERIAL = JSON.parse(SDN).serial_number as string;

function ataSsdAttributesOfSdn() {
  return db
    .select({ ataSsdAttributes: disk.ataSsdAttributes })
    .from(disk)
    .where(eq(disk.serial, SDN_SERIAL))
    .get()?.ataSsdAttributes;
}

function forgetAtaSsdAttributes() {
  db.update(disk).set({ ataSsdAttributes: null }).run();
}

beforeEach(() => {
  flushDb();
  const outcome = recordIngest({
    hostName: "mars",
    source: "smartctl-xall",
    meta: { device: "/dev/sdn", type: "sat" },
    body: SDN,
    receivedAt: t0,
  });
  expect(outcome.ok).toBe(true);
  forgetAtaSsdAttributes();
});

describe("backfillAtaSsdAttributesOnce", () => {
  it("re-parses the latest raw reading", async () => {
    expect(backfillAtaSsdAttributesOnce(t0)).toBe(true);
    expect(ataSsdAttributesOfSdn()).toEqual({
      wear: "245",
      written: { attrId: "241", unitBytes: 32 * 1024 ** 2, inferred: false },
    });
    expect((await getSettings()).config.ataSsdAttributesBackfilledAt).toBe(
      t0.toISOString(),
    );
  });

  it("runs once", () => {
    backfillAtaSsdAttributesOnce(t0);
    forgetAtaSsdAttributes();
    expect(backfillAtaSsdAttributesOnce(t0)).toBe(false);
    expect(ataSsdAttributesOfSdn()).toBeNull();
  });
});
