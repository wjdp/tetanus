import { eq, isNotNull, sql } from "drizzle-orm";
import { isDisposed, isHistoryState } from "#shared/disk";
import { FAULT_SEVERITY_RANK } from "#shared/faults";
import { attributeClass } from "#shared/smart/classification";
import { db } from "~~/server/database/client";
import { fault, smartReading } from "~~/server/database/schema";
import type { DiskSummary } from "~~/server/services/disks";
import type { Detection, FaultRow } from "~~/server/services/faults";

interface CountedReading {
  diskId: number;
  count: number;
  takenAt: Date;
}

interface ErrorLogReadings {
  latest: CountedReading;
  previous?: CountedReading;
}

function latestCountedReadings(): Map<number, ErrorLogReadings> {
  const ranked = db
    .select({
      diskId: smartReading.diskId,
      count: smartReading.errorLogCount,
      takenAt: smartReading.takenAt,
      rank: sql<number>`row_number() over (partition by ${smartReading.diskId} order by ${smartReading.takenAt} desc)`.as(
        "rank",
      ),
    })
    .from(smartReading)
    .where(isNotNull(smartReading.errorLogCount))
    .as("ranked");
  const rows = db
    .select()
    .from(ranked)
    .where(sql`${ranked.rank} <= 2`)
    .orderBy(ranked.diskId, sql`${ranked.rank}`)
    .all();
  const readings = new Map<number, ErrorLogReadings>();
  for (const row of rows) {
    const reading = {
      diskId: row.diskId,
      count: row.count as number,
      takenAt: row.takenAt,
    };
    const known = readings.get(row.diskId);
    if (known) known.previous = reading;
    else readings.set(row.diskId, { latest: reading });
  }
  return readings;
}

interface ErrorLogHistory {
  live: Map<string, FaultRow>;
  lastResolvedAt: Map<string, Date>;
}

function errorLogHistory(): ErrorLogHistory {
  const live = new Map<string, FaultRow>();
  const lastResolvedAt = new Map<string, Date>();
  const rows = db
    .select()
    .from(fault)
    .where(eq(fault.kind, "error-log-growth"))
    .all();
  for (const row of rows) {
    if (row.resolvedAt === null) {
      live.set(row.key, row);
      continue;
    }
    const known = lastResolvedAt.get(row.key);
    if (!known || row.resolvedAt > known) {
      lastResolvedAt.set(row.key, row.resolvedAt);
    }
  }
  return { live, lastResolvedAt };
}

export interface ErrorLogGrowthData {
  count: number;
  rise: number;
  previousCount: number;
  firstRiseAt: string;
}

// A live fault measures rises against the count it last saw, so rescanning
// the same readings adds nothing and a fall (log reset) re-baselines it.
// Without one, a rise between the two latest readings opens a fault, but
// only from a reading taken after the last resolution.
function errorLogGrowth(
  key: string,
  { latest, previous }: ErrorLogReadings,
  history: ErrorLogHistory,
): { data: ErrorLogGrowthData; newRise: number } | null {
  const live = history.live.get(key);
  if (live) {
    const data = live.data as unknown as ErrorLogGrowthData;
    const newRise = Math.max(0, latest.count - data.count);
    return {
      data: { ...data, count: latest.count, rise: data.rise + newRise },
      newRise,
    };
  }
  if (!previous || latest.count <= previous.count) return null;
  const resolvedAt = history.lastResolvedAt.get(key);
  if (resolvedAt && latest.takenAt <= resolvedAt) return null;
  const rise = latest.count - previous.count;
  return {
    data: {
      count: latest.count,
      rise,
      previousCount: previous.count,
      firstRiseAt: latest.takenAt.toISOString(),
    },
    newRise: rise,
  };
}

export function detectErrorLogGrowth({
  disks,
}: {
  disks: DiskSummary[];
  now: Date;
}): Detection[] {
  const readings = latestCountedReadings();
  if (readings.size === 0) return [];
  const history = errorLogHistory();
  return disks.flatMap((row): Detection[] => {
    if (isHistoryState(row.state) || isDisposed(row)) return [];
    const diskReadings = readings.get(row.id);
    if (!diskReadings) return [];
    const key = String(row.id);
    const growth = errorLogGrowth(key, diskReadings, history);
    if (!growth) return [];
    const detection: Detection = {
      kind: "error-log-growth",
      key,
      subjectId: row.id,
      severity: "warning",
      data: { ...growth.data },
      reopen: () => growth.newRise > 0,
    };
    newRises.set(detection, growth.newRise);
    return [detection];
  });
}

const newRises = new WeakMap<Detection, number>();

const isDefectFault = (detection: Detection) =>
  detection.kind === "smart-attribute" &&
  attributeClass(String(detection.data.attrId)) === "defect";

function worstDefectFault(defects: Detection[], diskId: number) {
  return defects
    .filter((detection) => detection.subjectId === diskId)
    .reduce<Detection | undefined>(
      (worst, detection) =>
        !worst ||
        FAULT_SEVERITY_RANK[detection.severity] >
          FAULT_SEVERITY_RANK[worst.severity]
          ? detection
          : worst,
      undefined,
    );
}

function keepErrorLogRise(detection: Detection, folded?: Detection) {
  const count = folded ? Number(folded.data.count) : undefined;
  const newRise = folded ? (newRises.get(folded) ?? 0) : 0;
  if (folded) {
    detection.data = {
      ...detection.data,
      errorLogRise: newRise,
      errorLogCount: count,
    };
  }
  detection.carry = (previous) => {
    const previousRise = Number(previous.errorLogRise) || 0;
    if (count === undefined) {
      if (previous.errorLogRise === undefined) return detection.data;
      return {
        ...detection.data,
        errorLogRise: previousRise,
        errorLogCount: previous.errorLogCount,
      };
    }
    const delta =
      typeof previous.errorLogCount === "number"
        ? Math.max(0, count - previous.errorLogCount)
        : newRise;
    return {
      ...detection.data,
      errorLogRise: previousRise + delta,
      errorLogCount: count,
    };
  };
}

// A rise in the error log on a disk with a defect fault escalates that fault
// (doc 100): its data carries the rise in place of a separate fault.
export function foldErrorLogGrowth(detections: Detection[]): Detection[] {
  const defects = detections.filter(isDefectFault);
  const folded = new Map<Detection, Detection>();
  const kept = detections.filter((detection) => {
    if (detection.kind !== "error-log-growth") return true;
    if (!newRises.get(detection)) return true;
    const target = worstDefectFault(defects, detection.subjectId);
    if (!target) return true;
    folded.set(target, detection);
    return false;
  });
  for (const defect of defects) keepErrorLogRise(defect, folded.get(defect));
  return kept;
}
