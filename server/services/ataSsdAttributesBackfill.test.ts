import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { ATA_SSD_ATTRIBUTES_VERSION } from "#shared/smart/ataSsdAttributes";
import { db } from "~~/server/database/client";
import { disk, setting } from "~~/server/database/schema";
import { backfillAtaSsdAttributesIfStale } from "~~/server/services/ataSsdAttributesBackfill";
import { recordIngest } from "~~/server/services/ingest";
import { ensureSettings, getSettings } from "~~/server/services/settings";
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

describe("backfillAtaSsdAttributesIfStale", () => {
  it("re-parses the latest raw reading", async () => {
    expect(backfillAtaSsdAttributesIfStale(t0)).toBe(true);
    expect(ataSsdAttributesOfSdn()).toEqual({
      wear: "245",
      written: { attrId: "241", unitBytes: 32 * 1024 ** 2, inferred: false },
      reserved: ["170", "179", "180"],
      defects: ["181", "182"],
    });
    expect((await getSettings()).config.ataSsdAttributesBackfilledAt).toBe(
      t0.toISOString(),
    );
  });

  it("records the derivation version", async () => {
    backfillAtaSsdAttributesIfStale(t0);
    expect((await getSettings()).config.ataSsdAttributesVersion).toBe(
      ATA_SSD_ATTRIBUTES_VERSION,
    );
  });

  it("re-runs after an unversioned backfill", () => {
    const { config } = ensureSettings();
    db.update(setting)
      .set({
        config: { ...config, ataSsdAttributesBackfilledAt: t0.toISOString() },
      })
      .run();
    expect(backfillAtaSsdAttributesIfStale(t0)).toBe(true);
    expect(ataSsdAttributesOfSdn()).not.toBeNull();
  });

  it("re-runs when the stored version is older", () => {
    const { config } = ensureSettings();
    db.update(setting)
      .set({
        config: {
          ...config,
          ataSsdAttributesVersion: ATA_SSD_ATTRIBUTES_VERSION - 1,
        },
      })
      .run();
    expect(backfillAtaSsdAttributesIfStale(t0)).toBe(true);
  });

  it("runs once per version", () => {
    backfillAtaSsdAttributesIfStale(t0);
    forgetAtaSsdAttributes();
    expect(backfillAtaSsdAttributesIfStale(t0)).toBe(false);
    expect(ataSsdAttributesOfSdn()).toBeNull();
  });
});
