import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "~~/server/database/client";
import { diaryEntry, fault } from "~~/server/database/schema";
import { performFaultAction, syncFaults } from "~~/server/services/faults";
import { recordIngest } from "~~/server/services/ingest";
import { flushDb } from "~~/test/db";
import { readFixture } from "~~/test/fixtures";

const t0 = new Date("2026-09-01T10:00:00Z");
const HOUR_MS = 60 * 60 * 1000;
const SDA = readFixture("mars/smartctl/xall-sda-auto.json");

const at = (hours: number) => new Date(t0.getTime() + hours * HOUR_MS);

function withErrorLogCount(count: number, reallocated?: number) {
  const json = JSON.parse(SDA);
  if (reallocated !== undefined) {
    const attribute = json.ata_smart_attributes.table.find(
      (row: { id: number }) => row.id === 5,
    );
    attribute.raw = { value: reallocated, string: String(reallocated) };
  }
  json.ata_smart_error_log = { extended: { revision: 1, sectors: 1, count } };
  return JSON.stringify(json);
}

async function scanAfterReading(
  count: number,
  hours: number,
  reallocated?: number,
) {
  const outcome = recordIngest({
    hostName: "mars",
    source: "smartctl-xall",
    meta: { device: "/dev/sda", type: "sat", exitStatus: 0 },
    body: withErrorLogCount(count, reallocated),
    receivedAt: at(hours),
  });
  expect(outcome.ok).toBe(true);
  await syncFaults(at(hours));
}

function errorLogFaults() {
  return db
    .select()
    .from(fault)
    .where(eq(fault.kind, "error-log-growth"))
    .orderBy(fault.id)
    .all();
}

const liveFault = () => errorLogFaults().find((row) => !row.resolvedAt);

beforeEach(() => {
  flushDb();
});

describe("detectErrorLogGrowth", () => {
  it("takes the first non-zero count as a baseline", async () => {
    await scanAfterReading(12, 0);
    expect(errorLogFaults()).toEqual([]);
  });

  it("raises on a rise over the previous reading", async () => {
    await scanAfterReading(12, 0);
    await scanAfterReading(15, 1);
    expect(liveFault()?.data).toEqual({
      count: 15,
      rise: 3,
      previousCount: 12,
      firstRiseAt: at(1).toISOString(),
    });
  });

  it("ranks readings taken at the same instant by arrival", async () => {
    await scanAfterReading(12, 0);
    await scanAfterReading(15, 0);
    expect(liveFault()?.data).toMatchObject({ count: 15, rise: 3 });
  });

  it("keeps a live fault without a new rise and accumulates later rises", async () => {
    await scanAfterReading(12, 0);
    await scanAfterReading(15, 1);
    await scanAfterReading(15, 2);
    await syncFaults(at(3));
    expect(liveFault()?.data).toMatchObject({ count: 15, rise: 3 });
    await scanAfterReading(17, 4);
    expect(liveFault()?.data).toMatchObject({ count: 17, rise: 5 });
    expect(errorLogFaults()).toHaveLength(1);
  });

  it("re-baselines on a reset and keeps the open fault", async () => {
    await scanAfterReading(12, 0);
    await scanAfterReading(15, 1);
    await scanAfterReading(0, 2);
    expect(liveFault()?.data).toMatchObject({ count: 0, rise: 3 });
    await scanAfterReading(2, 3);
    expect(liveFault()?.data).toMatchObject({ count: 2, rise: 5 });
  });

  it("does not raise on a fall with no live fault", async () => {
    await scanAfterReading(15, 0);
    await scanAfterReading(0, 1);
    expect(errorLogFaults()).toEqual([]);
  });

  it("reopens an accepted fault only on a further rise", async () => {
    await scanAfterReading(12, 0);
    await scanAfterReading(15, 1);
    const id = liveFault()?.id as number;
    performFaultAction(id, "accept", { now: at(1) });
    await scanAfterReading(15, 2);
    expect(liveFault()?.state).toBe("accepted");
    await scanAfterReading(16, 3);
    expect(liveFault()?.state).toBe("open");
  });

  it("opens a new fault after resolution only on a later rise", async () => {
    await scanAfterReading(12, 0);
    await scanAfterReading(15, 1);
    performFaultAction(liveFault()?.id as number, "resolve", { now: at(1) });
    await syncFaults(at(2));
    expect(liveFault()).toBeUndefined();
    await scanAfterReading(18, 3);
    expect(liveFault()?.data).toMatchObject({
      count: 18,
      rise: 3,
      previousCount: 15,
    });
  });

  it("folds a rise into the disk's defect fault instead of raising its own", async () => {
    const reallocatedFault = () =>
      db
        .select()
        .from(fault)
        .where(eq(fault.kind, "smart-attribute"))
        .all()
        .find((row) => row.data.attrId === "5");
    await scanAfterReading(12, 0, 0);
    await scanAfterReading(15, 1, 50);
    expect(errorLogFaults()).toEqual([]);
    expect(reallocatedFault()?.data).toMatchObject({ errorLogRise: 3 });
    await scanAfterReading(15, 2, 50);
    await syncFaults(at(3));
    expect(reallocatedFault()?.data).toMatchObject({ errorLogRise: 3 });
    await scanAfterReading(17, 4, 50);
    expect(reallocatedFault()?.data).toMatchObject({ errorLogRise: 5 });
    expect(errorLogFaults()).toEqual([]);
  });

  it("reopens an accepted defect fault when a folded rise arrives", async () => {
    const reallocatedFault = () =>
      db
        .select()
        .from(fault)
        .where(eq(fault.kind, "smart-attribute"))
        .all()
        .find((row) => row.data.attrId === "5" && !row.resolvedAt);
    const supersessions = () =>
      db
        .select()
        .from(diaryEntry)
        .where(eq(diaryEntry.eventType, "acceptance-superseded"))
        .all();
    await scanAfterReading(12, 0, 0);
    await scanAfterReading(15, 1, 50);
    const id = reallocatedFault()?.id as number;
    performFaultAction(id, "accept", { now: at(1) });
    await scanAfterReading(15, 2, 50);
    expect(reallocatedFault()?.state).toBe("accepted");
    await scanAfterReading(17, 3, 50);
    expect(reallocatedFault()?.state).toBe("open");
    expect(supersessions().map((row) => row.title)).toEqual([
      "Error log grew by 2 to 17 (accepted at 50)",
    ]);
    performFaultAction(id, "accept", { now: at(3) });
    await scanAfterReading(17, 4, 50);
    await syncFaults(at(5));
    expect(reallocatedFault()?.state).toBe("accepted");
    expect(supersessions()).toHaveLength(1);
  });

  it("resolves a live fault as superseded once the disk has a defect fault", async () => {
    await scanAfterReading(12, 0, 0);
    await scanAfterReading(15, 1, 0);
    expect(liveFault()).toBeDefined();
    await scanAfterReading(15, 2, 50);
    expect(liveFault()).toBeUndefined();
    const resolution = db
      .select()
      .from(diaryEntry)
      .where(eq(diaryEntry.eventType, "fault-resolved"))
      .all()
      .find((entry) => entry.data.kind === "error-log-growth");
    expect(resolution?.data.supersededBy).toEqual({
      kind: "smart-attribute",
      key: expect.stringMatching(/:5$/),
    });
    await scanAfterReading(18, 3, 50);
    expect(liveFault()).toBeUndefined();
    const defect = db
      .select()
      .from(fault)
      .where(eq(fault.kind, "smart-attribute"))
      .all()
      .find((row) => row.data.attrId === "5");
    expect(defect?.data).toMatchObject({ errorLogRise: 3, errorLogCount: 18 });
  });
});
