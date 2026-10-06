import { inArray } from "drizzle-orm";
import { isDisposed, isHistoryState } from "#shared/disk";
import type { FaultData } from "#shared/faults";
import { db } from "~~/server/database/client";
import { selfTest } from "~~/server/database/schema";
import type { DiskSummary } from "~~/server/services/disks";
import type { Detection } from "~~/server/services/faults";

type SelfTestRow = typeof selfTest.$inferSelect;
type SelfTestOutcome = "passed" | "failed" | "inconclusive";

const ATA_HOURS_WRAP = 65_536;

const INCONCLUSIVE_STATUS = /abort|interrupt|progress/i;
const PASSED_STATUS = /^completed( without error)?$/i;
const FAILED_STATUS = /fail|error|damage/i;
const LONG_TYPE = /long|extended/i;

export function selfTestOutcome(
  row: Pick<SelfTestRow, "status" | "passed">,
): SelfTestOutcome {
  const status = row.status.trim();
  if (INCONCLUSIVE_STATUS.test(status)) return "inconclusive";
  if (PASSED_STATUS.test(status)) return "passed";
  if (FAILED_STATUS.test(status)) return "failed";
  return row.passed ? "passed" : "failed";
}

export function selfTestRank(type: string) {
  return LONG_TYPE.test(type) ? 2 : 1;
}

function hoursAfter(a: number, b: number) {
  const wrapped =
    a < ATA_HOURS_WRAP &&
    b < ATA_HOURS_WRAP &&
    Math.abs(a - b) > ATA_HOURS_WRAP / 2;
  return wrapped ? a < b : a > b;
}

function newestFirst(a: SelfTestRow, b: SelfTestRow) {
  const seen = b.seenAt.getTime() - a.seenAt.getTime();
  if (seen !== 0) return seen;
  if (a.lifetimeHours === b.lifetimeHours) return 0;
  return hoursAfter(a.lifetimeHours, b.lifetimeHours) ? -1 : 1;
}

function sameTest(row: SelfTestRow, data: FaultData) {
  return row.type === data.type && row.lifetimeHours === data.lifetimeHours;
}

export function unresolvedFailure(rows: SelfTestRow[]) {
  const ordered = rows.toSorted(newestFirst);
  let longestLaterPass = 0;
  for (const row of ordered) {
    const outcome = selfTestOutcome(row);
    const rank = selfTestRank(row.type);
    if (outcome === "passed")
      longestLaterPass = Math.max(longestLaterPass, rank);
    if (outcome === "failed" && rank > longestLaterPass) {
      return { failure: row, ordered };
    }
  }
  return null;
}

function newerFailure(
  ordered: SelfTestRow[],
  failure: SelfTestRow,
  previous: FaultData,
) {
  if (sameTest(failure, previous)) return false;
  const previousRow = ordered.find((row) => sameTest(row, previous));
  return !previousRow || newestFirst(failure, previousRow) < 0;
}

function selfTestsByDisk(diskIds: number[]) {
  const byDisk = new Map<number, SelfTestRow[]>();
  if (diskIds.length === 0) return byDisk;
  const rows = db
    .select()
    .from(selfTest)
    .where(inArray(selfTest.diskId, diskIds))
    .all();
  for (const row of rows) {
    byDisk.set(row.diskId, [...(byDisk.get(row.diskId) ?? []), row]);
  }
  return byDisk;
}

export function detectSelfTestFailed({
  disks,
}: {
  disks: DiskSummary[];
}): Detection[] {
  const inService = disks.filter(
    (row) => !isHistoryState(row.state) && !isDisposed(row),
  );
  const tests = selfTestsByDisk(inService.map((row) => row.id));
  return inService.flatMap((row): Detection[] => {
    const unresolved = unresolvedFailure(tests.get(row.id) ?? []);
    if (!unresolved) return [];
    const { failure, ordered } = unresolved;
    return [
      {
        kind: "self-test-failed",
        key: String(row.id),
        subjectId: row.id,
        severity: "error",
        data: {
          type: failure.type,
          status: failure.status,
          lifetimeHours: failure.lifetimeHours,
          lba: failure.lba,
        },
        reopen: (previous) => newerFailure(ordered, failure, previous),
      },
    ];
  });
}
