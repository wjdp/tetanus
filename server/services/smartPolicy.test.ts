import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { SMART_POLICY_VERSION } from "#shared/smart/classification";
import { db } from "~~/server/database/client";
import {
  disk,
  setting,
  smartAttribute,
  smartReading,
} from "~~/server/database/schema";
import { acceptFault } from "~~/server/services/acceptance";
import { listDiary } from "~~/server/services/diary";
import { recordIngest } from "~~/server/services/ingest";
import { ensureSettings } from "~~/server/services/settings";
import { getSmartOverview } from "~~/server/services/smart";
import {
  applySmartPolicyIfStale,
  reapplySmartPolicy,
} from "~~/server/services/smartPolicy";
import { flushDb } from "~~/test/db";
import { readFixture } from "~~/test/fixtures";

const t0 = new Date("2026-09-01T10:00:00Z");
const HOUR_MS = 60 * 60 * 1000;
const SDB = readFixture("mars/smartctl/xall-sdb-auto.json");
const SDB_SERIAL = JSON.parse(SDB).serial_number as string;
const SPIN_UP_TIME_PACKED_RAW = 34385822097;

function at(offsetMs: number) {
  return new Date(t0.getTime() + offsetMs);
}

function withAttributeRaw(body: string, attrId: number, raw: number) {
  const json = JSON.parse(body);
  const attribute = json.ata_smart_attributes.table.find(
    (row: { id: number }) => row.id === attrId,
  );
  attribute.raw = { value: raw, string: String(raw) };
  return JSON.stringify(json);
}

function ingestSdb(body: string) {
  const outcome = recordIngest({
    hostName: "mars",
    source: "smartctl-xall",
    meta: { device: "/dev/sdb", type: "sat", exitStatus: 0 },
    body,
    receivedAt: t0,
  });
  expect(outcome.ok).toBe(true);
}

function sdb() {
  const row = db.select().from(disk).where(eq(disk.serial, SDB_SERIAL)).get();
  if (!row) throw new Error("sdb not ingested");
  return row;
}

function storedAttribute(diskId: number, attrId: string) {
  return db
    .select()
    .from(smartAttribute)
    .where(
      and(eq(smartAttribute.diskId, diskId), eq(smartAttribute.attrId, attrId)),
    )
    .get();
}

function rewriteAttribute(
  diskId: number,
  attrId: string,
  values: Partial<typeof smartAttribute.$inferInsert>,
) {
  db.update(smartAttribute)
    .set(values)
    .where(
      and(eq(smartAttribute.diskId, diskId), eq(smartAttribute.attrId, attrId)),
    )
    .run();
}

function setStatus(diskId: number, status: "warning" | "failed") {
  db.update(disk)
    .set({ latestStatus: status })
    .where(eq(disk.id, diskId))
    .run();
  db.update(smartReading)
    .set({ deviceStatus: status })
    .where(eq(smartReading.diskId, diskId))
    .run();
}

function events(diskId: number, eventType: string) {
  return listDiary({ subjectType: "disk", subjectId: diskId }).filter(
    (entry) => entry.eventType === eventType,
  );
}

function storedPolicyVersion() {
  return db.select().from(setting).get()?.config.smartPolicyVersion;
}

function applyOldPolicy(diskId: number) {
  rewriteAttribute(diskId, "4", {
    status: "warning",
    failureRate: 0.2,
    reason: "Observed failure rate above warning threshold",
  });
  rewriteAttribute(diskId, "3", { transformedValue: SPIN_UP_TIME_PACKED_RAW });
  setStatus(diskId, "warning");
}

beforeEach(() => {
  flushDb();
});

describe("reapplySmartPolicy", () => {
  it("re-evaluates the latest reading and records the status change", () => {
    ingestSdb(withAttributeRaw(withAttributeRaw(SDB, 197, 0), 198, 0));
    const diskId = sdb().id;
    const fresh = storedAttribute(diskId, "4");
    applyOldPolicy(diskId);

    expect(reapplySmartPolicy(at(HOUR_MS))).toEqual({ disks: 1, changed: 1 });

    expect(storedAttribute(diskId, "4")).toEqual(fresh);
    expect(storedAttribute(diskId, "3")?.transformedValue).toBe(401);
    expect(sdb().latestStatus).toBe("passed");
    expect(getSmartOverview(diskId, "30d").reading?.deviceStatus).toBe(
      "passed",
    );
    expect(events(diskId, "smart-status-changed")).toMatchObject([
      { at: at(HOUR_MS), data: { from: "warning", to: "passed" } },
    ]);
    expect(events(diskId, "attribute-status-changed")).toHaveLength(0);
  });

  it("leaves freshly evaluated readings untouched", () => {
    ingestSdb(SDB);
    const diskId = sdb().id;
    const before = getSmartOverview(diskId, "30d", t0);

    expect(reapplySmartPolicy(at(HOUR_MS))).toEqual({ disks: 1, changed: 0 });

    expect(getSmartOverview(diskId, "30d", t0)).toEqual(before);
  });

  it("keeps an accepted fault from failing the disk", () => {
    ingestSdb(withAttributeRaw(SDB, 198, 0));
    const diskId = sdb().id;
    acceptFault({ diskId, attrId: "197", now: t0 });
    expect(sdb().latestStatus).toBe("passed");
    rewriteAttribute(diskId, "197", { status: "passed" });
    setStatus(diskId, "failed");

    reapplySmartPolicy(at(HOUR_MS));

    expect(storedAttribute(diskId, "197")?.status).toBe("failed");
    expect(sdb().latestStatus).toBe("passed");
    const reapplied = events(diskId, "smart-status-changed").filter(
      (entry) => entry.at.getTime() === at(HOUR_MS).getTime(),
    );
    expect(reapplied).toMatchObject([
      { data: { from: "failed", to: "passed" } },
    ]);
  });
});

describe("applySmartPolicyIfStale", () => {
  it("applies the policy once and stores its version", () => {
    ensureSettings();
    ingestSdb(withAttributeRaw(withAttributeRaw(SDB, 197, 0), 198, 0));
    const diskId = sdb().id;
    applyOldPolicy(diskId);

    expect(applySmartPolicyIfStale(at(HOUR_MS))).toBe(true);
    expect(storedPolicyVersion()).toBe(SMART_POLICY_VERSION);
    expect(sdb().latestStatus).toBe("passed");

    applyOldPolicy(diskId);
    expect(applySmartPolicyIfStale(at(2 * HOUR_MS))).toBe(false);
    expect(sdb().latestStatus).toBe("warning");
    expect(events(diskId, "smart-status-changed")).toHaveLength(1);
  });
});
