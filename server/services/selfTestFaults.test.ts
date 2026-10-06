import { beforeEach, describe, expect, it } from "vitest";
import { db } from "~~/server/database/client";
import { disk, selfTest } from "~~/server/database/schema";
import type { DiskSummary } from "~~/server/services/disks";
import { flushDb } from "~~/test/db";
import { detectSelfTestFailed, selfTestOutcome } from "./selfTestFaults";

const HOUR_MS = 60 * 60 * 1000;
const t0 = new Date("2026-01-01T00:00:00Z");
const at = (hours: number) => new Date(t0.getTime() + hours * HOUR_MS);

const SHORT = "Short offline";
const LONG = "Extended offline";
const READ_FAILURE = "Completed: read failure";
const PASSED = "Completed without error";

let diskId: number;

function summary(overrides: Partial<DiskSummary> = {}) {
  return {
    id: diskId,
    state: "in-use",
    disposal: null,
    ...overrides,
  } as DiskSummary;
}

function recordTest(
  type: string,
  status: string,
  lifetimeHours: number,
  seenAt: Date,
  lba: number | null = null,
) {
  db.insert(selfTest)
    .values({
      diskId,
      type,
      status,
      passed: status === PASSED,
      lifetimeHours,
      lba,
      seenAt,
    })
    .run();
}

const detect = (overrides?: Partial<DiskSummary>) =>
  detectSelfTestFailed({ disks: [summary(overrides)] });

beforeEach(() => {
  flushDb();
  diskId = db
    .insert(disk)
    .values({ alias: "D1", lastSeenAt: t0, lastState: "in-use" })
    .returning()
    .get().id;
});

describe("selfTestOutcome", () => {
  it.each([
    ["Completed without error", true, "passed"],
    ["Completed", true, "passed"],
    ["Completed: read failure", false, "failed"],
    ["Completed: electrical failure", false, "failed"],
    ["Completed: servo/seek failure", false, "failed"],
    ["Completed: unknown failure", false, "failed"],
    ["Completed: handling damage??", false, "failed"],
    ["Completed: failed segments", false, "failed"],
    ["Fatal or unknown error", false, "failed"],
    ["Aborted by host", false, "inconclusive"],
    ["Interrupted (host reset)", false, "inconclusive"],
    ["Self-test routine in progress", false, "inconclusive"],
    ["Aborted: Controller Reset", false, "inconclusive"],
  ])("classifies %s", (status, passed, outcome) => {
    expect(selfTestOutcome({ status, passed })).toBe(outcome);
  });
});

describe("detectSelfTestFailed", () => {
  it("raises one fault for the newest failed test", () => {
    recordTest(SHORT, READ_FAILURE, 100, at(0), 10);
    recordTest(LONG, READ_FAILURE, 110, at(10), 20);

    const detections = detect();

    expect(detections).toHaveLength(1);
    expect(detections[0]).toMatchObject({
      kind: "self-test-failed",
      key: String(diskId),
      subjectId: diskId,
      severity: "error",
      data: { type: LONG, status: READ_FAILURE, lifetimeHours: 110, lba: 20 },
    });
  });

  it("ignores aborted, interrupted and in-progress tests", () => {
    recordTest(LONG, "Aborted by host", 100, at(0));
    recordTest(SHORT, "Interrupted (host reset)", 101, at(1));
    recordTest(SHORT, "Self-test routine in progress", 102, at(2));

    expect(detect()).toEqual([]);
  });

  it("does not let an aborted test resolve a failure", () => {
    recordTest(SHORT, READ_FAILURE, 100, at(0), 10);
    recordTest(LONG, "Aborted by host", 101, at(1));

    expect(detect()).toHaveLength(1);
  });

  it("resolves a failed short test with a later passed short test", () => {
    recordTest(SHORT, READ_FAILURE, 100, at(0), 10);
    recordTest(SHORT, PASSED, 101, at(1));

    expect(detect()).toEqual([]);
  });

  it("resolves a failed long test only with a later passed long test", () => {
    recordTest(LONG, READ_FAILURE, 100, at(0), 10);
    recordTest(SHORT, PASSED, 101, at(1));
    expect(detect()[0]?.data).toMatchObject({ type: LONG, lifetimeHours: 100 });

    recordTest(LONG, PASSED, 102, at(2));
    expect(detect()).toEqual([]);
  });

  it("ranks conveyance and selective tests with short", () => {
    recordTest("Conveyance offline", READ_FAILURE, 100, at(0), 10);
    recordTest("Selective offline", PASSED, 101, at(1));
    expect(detect()).toEqual([]);

    recordTest(LONG, READ_FAILURE, 102, at(2), 30);
    recordTest("Conveyance offline", PASSED, 103, at(3));
    expect(detect()[0]?.data).toMatchObject({ type: LONG });
  });

  it("orders by when a test was first seen across an hours wraparound", () => {
    recordTest(LONG, READ_FAILURE, 65_500, at(0), 10);
    recordTest(LONG, PASSED, 20, at(100));

    expect(detect()).toEqual([]);
  });

  it("orders tests first seen together by wrapped lifetime hours", () => {
    recordTest(LONG, PASSED, 65_500, at(0));
    recordTest(LONG, READ_FAILURE, 20, at(0), 10);

    expect(detect()[0]?.data).toMatchObject({ lifetimeHours: 20 });
  });

  it("ignores disks out of service", () => {
    recordTest(LONG, READ_FAILURE, 100, at(0), 10);

    expect(detect({ state: "retired" })).toEqual([]);
    expect(detect({ state: "dead" })).toEqual([]);
    expect(
      detect({ disposal: {} as NonNullable<DiskSummary["disposal"]> }),
    ).toEqual([]);
  });

  it("reopens only when a newer test fails", () => {
    recordTest(SHORT, READ_FAILURE, 100, at(0), 10);
    const [first] = detect();
    if (!first) throw new Error("No detection");
    expect(first.reopen?.(first.data)).toBe(false);

    recordTest(LONG, READ_FAILURE, 110, at(10), 20);
    expect(detect()[0]?.reopen?.(first.data)).toBe(true);
  });

  it("does not reopen for an older failure left after a newer one resolves", () => {
    recordTest(LONG, READ_FAILURE, 100, at(0), 10);
    recordTest(SHORT, READ_FAILURE, 110, at(10), 20);
    const [shortFailure] = detect();
    if (!shortFailure) throw new Error("No detection");

    recordTest(SHORT, PASSED, 120, at(20));
    const [longFailure] = detect();
    expect(longFailure?.data).toMatchObject({ type: LONG });
    expect(longFailure?.reopen?.(shortFailure.data)).toBe(false);
  });
});
