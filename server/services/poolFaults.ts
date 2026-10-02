import { and, asc, desc, eq, gt, inArray, lte, max } from "drizzle-orm";
import type {
  FaultData,
  FaultKind,
  FaultSeverity,
  LeafCounts,
  PoolDegradedLeaf,
} from "#shared/faults";
import { isHostOffline } from "#shared/hostFreshness";
import { resolvePoolConfig } from "#shared/schemas/pools";
import { zfsStateColour } from "#shared/zfsState";
import { db } from "~~/server/database/client";
import {
  collectorRun,
  diaryEntry,
  fault,
  pool,
  vdev,
  vdevReading,
} from "~~/server/database/schema";
import type {
  Detection,
  DetectionContext,
  Supersession,
} from "~~/server/services/faults";

type PoolRow = typeof pool.$inferSelect;
type VdevRow = typeof vdev.$inferSelect;

export const POOL_FAULT_KINDS = [
  "pool-degraded",
  "pool-missing",
  "leaf-errors",
  "leaf-slow",
  "pool-data-errors",
  "scrub-overdue",
] as const satisfies readonly FaultKind[];

const LEAF_FAULT_KINDS: FaultKind[] = ["leaf-errors", "leaf-slow"];

export const SCAN_FINISHED_EVENTS = [
  "scrub-finished",
  "resilver-finished",
  "scan-finished",
] as const;

export const LEAF_TYPES: ReadonlySet<string> = new Set(["disk", "file"]);

const DAY_MS = 24 * 60 * 60 * 1000;
export const LEAF_WINDOW_MS = DAY_MS;

const iso = (date: Date | null) => date?.toISOString() ?? null;

export function poolSeverity(state: string): FaultSeverity {
  return zfsStateColour(state) === "error" ? "error" : "warning";
}

export function worstSeverity(severities: FaultSeverity[]): FaultSeverity {
  return severities.includes("error") ? "error" : "warning";
}

export function isHealthyLeafState(state: string, role: string) {
  return state === "ONLINE" || (role === "spare" && state === "AVAIL");
}

export const leafKey = (poolId: number, vdevGuid: string) =>
  `${poolId}:${vdevGuid}`;

function leafCounts(
  row: Pick<VdevRow, "readErrors" | "writeErrors" | "checksumErrors">,
): LeafCounts {
  return {
    read: row.readErrors,
    write: row.writeErrors,
    checksum: row.checksumErrors,
  };
}

export function hasLeafErrors(counts: LeafCounts) {
  return counts.read + counts.write + counts.checksum > 0;
}

export function countsRose(counts: LeafCounts, baseline: unknown) {
  if (typeof baseline !== "object" || baseline === null) return false;
  const level = baseline as Partial<LeafCounts>;
  return (
    counts.read > Number(level.read ?? 0) ||
    counts.write > Number(level.write ?? 0) ||
    counts.checksum > Number(level.checksum ?? 0)
  );
}

function latestStatusTimes(): Map<number, Date> {
  return new Map(
    db
      .select({ hostId: collectorRun.hostId, at: max(collectorRun.receivedAt) })
      .from(collectorRun)
      .where(
        and(eq(collectorRun.source, "zpool-status"), eq(collectorRun.ok, true)),
      )
      .groupBy(collectorRun.hostId)
      .all()
      .flatMap(({ hostId, at }) => (at ? [[hostId, at] as const] : [])),
  );
}

interface PoolScope {
  row: PoolRow;
  vdevs: VdevRow[];
  leaves: VdevRow[];
  referenceAt: Date;
}

interface Counters extends LeafCounts {
  slowIos: number;
}

type CounterColumns = Pick<
  VdevRow,
  "readErrors" | "writeErrors" | "checksumErrors" | "slowIos"
>;

function countersOf(row: CounterColumns): Counters {
  return { ...leafCounts(row), slowIos: row.slowIos ?? 0 };
}

function readingAtOrBefore(vdevId: number, at: Date) {
  return db
    .select()
    .from(vdevReading)
    .where(and(eq(vdevReading.vdevId, vdevId), lte(vdevReading.at, at)))
    .orderBy(desc(vdevReading.at), desc(vdevReading.id))
    .limit(1)
    .get();
}

function readingsBetween(vdevId: number, after: Date, until: Date) {
  return db
    .select()
    .from(vdevReading)
    .where(
      and(
        eq(vdevReading.vdevId, vdevId),
        gt(vdevReading.at, after),
        lte(vdevReading.at, until),
      ),
    )
    .orderBy(asc(vdevReading.at), asc(vdevReading.id))
    .all();
}

// Counters reset on reboot or import, so a rise is any increase over the
// previous reading, summed; a drop is a new baseline, never a negative rise.
// Without a baseline the first reading is one: only what was seen counts.
export function accumulatedRise(
  baseline: Counters | undefined,
  readings: Counters[],
): Counters {
  const rise: Counters = { read: 0, write: 0, checksum: 0, slowIos: 0 };
  let previous = baseline;
  for (const reading of readings) {
    if (previous) {
      for (const counter of Object.keys(rise) as (keyof Counters)[]) {
        rise[counter] += Math.max(0, reading[counter] - previous[counter]);
      }
    }
    previous = reading;
  }
  return rise;
}

function riseSince(
  vdevId: number,
  since: Date,
  until: Date,
  baseline?: Counters,
): Counters {
  const start = baseline ?? readingAtOrBefore(vdevId, since);
  return accumulatedRise(
    start && ("vdevId" in start ? countersOf(start) : start),
    readingsBetween(vdevId, since, until).map(countersOf),
  );
}

function riseInWindow(leaf: VdevRow, referenceAt: Date) {
  return riseSince(
    leaf.id,
    new Date(referenceAt.getTime() - LEAF_WINDOW_MS),
    referenceAt,
  );
}

interface Degraded {
  detection: Detection;
  listed: VdevRow[];
}

function listedLeaves(leaves: unknown): Map<string, PoolDegradedLeaf> {
  if (!Array.isArray(leaves)) return new Map();
  return new Map(
    (leaves as PoolDegradedLeaf[]).map((leaf) => [leaf.vdevGuid, leaf]),
  );
}

// A new failed leaf, or a rise on one already listed (its leaf-errors are
// folded into this fault), reopens a quiet pool-degraded row.
export function poolDegradedWorsened(
  leaves: PoolDegradedLeaf[],
  previousLeaves: unknown,
) {
  const before = listedLeaves(previousLeaves);
  return leaves.some((leaf) => {
    const previous = before.get(leaf.vdevGuid);
    return previous === undefined || countsRose(leaf, previous);
  });
}

function detectPoolDegraded(
  { row, leaves }: PoolScope,
  missingDiskIds: Set<number>,
): Degraded | null {
  const failed = leaves.filter(
    (leaf) => !isHealthyLeafState(leaf.state, leaf.role),
  );
  if (row.state === "ONLINE" && failed.length === 0) return null;
  const listed = failed;
  const severities = [
    ...(row.state === "ONLINE" ? [] : [poolSeverity(row.state)]),
    ...failed.map((leaf) => poolSeverity(leaf.state)),
  ];
  const leafData = listed.map(
    (leaf): PoolDegradedLeaf => ({
      vdevGuid: leaf.guid,
      name: leaf.name,
      state: leaf.state,
      role: leaf.role,
      diskId: leaf.diskId,
      diskMissing: leaf.diskId !== null && missingDiskIds.has(leaf.diskId),
      ...leafCounts(leaf),
    }),
  );
  return {
    listed,
    detection: {
      kind: "pool-degraded",
      key: String(row.id),
      subjectId: row.id,
      severity: worstSeverity(severities),
      data: { state: row.state, poolName: row.name, leaves: leafData },
      reopen: (previous) => poolDegradedWorsened(leafData, previous.leaves),
    },
  };
}

function leafData(row: PoolRow, leaf: VdevRow): FaultData {
  return {
    poolName: row.name,
    vdevGuid: leaf.guid,
    name: leaf.name,
    role: LEAF_TYPES.has(leaf.type) ? leaf.role : "group",
    diskId: leaf.diskId,
  };
}

export const leafErrorsSeverity = (role: unknown): FaultSeverity =>
  role === "group" ? "error" : "warning";

type FaultRow = typeof fault.$inferSelect;

export interface LeafErrorHistory {
  live: Map<string, FaultRow>;
  lastResolvedAt: Map<string, Date>;
}

function leafErrorHistory(): LeafErrorHistory {
  const live = new Map<string, FaultRow>();
  const lastResolvedAt = new Map<string, Date>();
  const rows = db
    .select()
    .from(fault)
    .where(eq(fault.kind, "leaf-errors"))
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

function countsFrom(value: unknown): LeafCounts {
  const counts = (value ?? {}) as Partial<LeafCounts>;
  return {
    read: Number(counts.read) || 0,
    write: Number(counts.write) || 0,
    checksum: Number(counts.checksum) || 0,
  };
}

export const addCounts = (a: LeafCounts, b: LeafCounts): LeafCounts => ({
  read: a.read + b.read,
  write: a.write + b.write,
  checksum: a.checksum + b.checksum,
});

// Opens on the first errors seen, or after a resolution only on a rise since
// it. A live fault never resolves on counters falling (a reboot or import
// resets them, indistinguishable from `zpool clear`): it carries the running
// total of rises, which acknowledgement levels against.
function leafErrorsTotal(
  key: string,
  leaf: VdevRow,
  referenceAt: Date,
  history: LeafErrorHistory,
): LeafCounts | null {
  const current = leafCounts(leaf);
  const live = history.live.get(key);
  if (live) {
    const previous = countsFrom(live.data);
    const rise = riseSince(leaf.id, live.lastSeenAt, referenceAt, {
      ...previous,
      slowIos: 0,
    });
    return addCounts(countsFrom(live.data.total), rise);
  }
  const resolvedAt = history.lastResolvedAt.get(key);
  if (!resolvedAt) return hasLeafErrors(current) ? current : null;
  const rise = riseSince(leaf.id, resolvedAt, referenceAt);
  return hasLeafErrors(rise) ? rise : null;
}

// Leaves and groups alike: a mirror or raidz counts errors it could not pin
// on one leaf.
function detectLeafErrors(
  { row, referenceAt }: PoolScope,
  vdevs: VdevRow[],
  history: LeafErrorHistory,
) {
  return vdevs.flatMap((leaf): Detection[] => {
    const key = leafKey(row.id, leaf.guid);
    const total = leafErrorsTotal(key, leaf, referenceAt, history);
    if (!total) return [];
    const data = leafData(row, leaf);
    return [
      {
        kind: "leaf-errors",
        key,
        subjectId: row.id,
        severity: leafErrorsSeverity(data.role),
        data: {
          ...data,
          ...leafCounts(leaf),
          total,
          rise24h: totalOf(riseInWindow(leaf, referenceAt)),
        },
        reopen: (previous) =>
          countsRose(total, previous.acknowledgedCounts ?? previous.total),
      },
    ];
  });
}

const totalOf = (counts: LeafCounts) =>
  counts.read + counts.write + counts.checksum;

function detectLeafSlow({ row, leaves, referenceAt }: PoolScope) {
  const threshold = resolvePoolConfig(row.config).slowIoThreshold;
  if (threshold === 0) return [];
  return leaves.flatMap((leaf): Detection[] => {
    if (leaf.slowIos === null) return [];
    const rise = riseInWindow(leaf, referenceAt).slowIos;
    if (rise < threshold) return [];
    return [
      {
        kind: "leaf-slow",
        key: leafKey(row.id, leaf.guid),
        subjectId: row.id,
        severity: "warning",
        data: {
          ...leafData(row, leaf),
          slowIos: leaf.slowIos,
          rise24h: rise,
          threshold,
        },
      },
    ];
  });
}

type DiaryEntryRow = typeof diaryEntry.$inferSelect;

function latestPoolEntries(
  poolIds: number[],
  eventTypes: readonly string[],
): Map<number, DiaryEntryRow> {
  const latest = new Map<number, DiaryEntryRow>();
  if (poolIds.length === 0) return latest;
  const entries = db
    .select()
    .from(diaryEntry)
    .where(
      and(
        eq(diaryEntry.subjectType, "pool"),
        inArray(diaryEntry.subjectId, poolIds),
        inArray(diaryEntry.eventType, [...eventTypes]),
      ),
    )
    .orderBy(desc(diaryEntry.at), desc(diaryEntry.id))
    .all();
  for (const entry of entries) {
    const poolId = entry.subjectId as number;
    if (!latest.has(poolId)) latest.set(poolId, entry);
  }
  return latest;
}

function detectPoolDataErrors(
  { row }: PoolScope,
  latestScan: DiaryEntryRow | undefined,
): Detection[] {
  const dataErrors = row.errors ?? 0;
  const scanErrors = Number(latestScan?.data.errors) || 0;
  if (dataErrors <= 0 && scanErrors <= 0) return [];
  const finishedAt = scanErrors > 0 ? iso(latestScan?.at ?? null) : null;
  return [
    {
      kind: "pool-data-errors",
      key: String(row.id),
      subjectId: row.id,
      severity: "error",
      data: {
        poolName: row.name,
        dataErrors,
        scanErrors,
        function: scanErrors > 0 ? latestScan?.data.function : null,
        finishedAt,
      },
      reopen: (previous) =>
        dataErrors > Number(previous.dataErrors ?? 0) ||
        (finishedAt !== null && finishedAt !== previous.finishedAt),
    },
  ];
}

function scanFinishedScrubAt(row: PoolRow) {
  const { scan } = row;
  if (scan?.state !== "FINISHED" || scan.endTime === undefined) return null;
  if (scan.function.toUpperCase() !== "SCRUB") return null;
  return new Date(scan.endTime * 1000);
}

function lastScrubAt(row: PoolRow, latestScrub: DiaryEntryRow | undefined) {
  const candidates = [
    row.lastScrub ? new Date(row.lastScrub.endAt) : null,
    latestScrub?.at ?? null,
    scanFinishedScrubAt(row),
  ].filter((at): at is Date => at !== null && !Number.isNaN(at.getTime()));
  if (candidates.length === 0) return null;
  return new Date(Math.max(...candidates.map((at) => at.getTime())));
}

function detectScrubOverdue(
  { row, referenceAt }: PoolScope,
  latestScrub: DiaryEntryRow | undefined,
): Detection[] {
  const { scrubIntervalDays } = resolvePoolConfig(row.config);
  if (scrubIntervalDays === 0) return [];
  const scrubbedAt = lastScrubAt(row, latestScrub);
  const since = scrubbedAt ?? row.firstSeenAt;
  if (referenceAt.getTime() - since.getTime() <= scrubIntervalDays * DAY_MS) {
    return [];
  }
  return [
    {
      kind: "scrub-overdue",
      key: String(row.id),
      subjectId: row.id,
      severity: "warning",
      data: {
        poolName: row.name,
        lastScrubAt: iso(scrubbedAt),
        firstSeenAt: iso(row.firstSeenAt),
        intervalDays: scrubIntervalDays,
      },
    },
  ];
}

function memberDiskIds(vdevs: VdevRow[]) {
  return vdevs.flatMap((row) => (row.diskId === null ? [] : [row.diskId]));
}

export interface PoolFaultScan {
  detections: Detection[];
  superseded: Supersession[];
}

export function detectPoolFaults(
  { now, disks, hosts, cadences }: DetectionContext,
  silentHostIds: Set<number>,
): PoolFaultScan {
  const latestStatus = latestStatusTimes();
  const offlineHostIds = new Set(
    hosts
      .filter((row) => isHostOffline(row, now.getTime(), cadences))
      .map((row) => row.id),
  );
  const missingDiskIds = new Set(
    disks.filter((row) => row.state === "missing").map((row) => row.id),
  );
  const vdevsByPool = new Map<number, VdevRow[]>();
  for (const row of db
    .select()
    .from(vdev)
    .where(eq(vdev.present, true))
    .all()) {
    vdevsByPool.set(row.poolId, [...(vdevsByPool.get(row.poolId) ?? []), row]);
  }

  const detections: Detection[] = [];
  const superseded: Supersession[] = [];
  const current: PoolScope[] = [];
  for (const row of db.select().from(pool).all()) {
    const vdevs = vdevsByPool.get(row.id) ?? [];
    if (silentHostIds.has(row.hostId)) {
      superseded.push({
        subjectType: "pool",
        subjectId: row.id,
        kinds: [...POOL_FAULT_KINDS],
        by: { kind: "collector-silent", key: String(row.hostId) },
      });
      continue;
    }
    const statusAt = latestStatus.get(row.hostId);
    if (!statusAt) continue;
    if (row.lastSeenAt >= statusAt) {
      current.push({
        row,
        vdevs,
        leaves: vdevs.filter((leaf) => LEAF_TYPES.has(leaf.type)),
        referenceAt: new Date(Math.min(now.getTime(), statusAt.getTime())),
      });
      continue;
    }
    if (offlineHostIds.has(row.hostId)) continue;
    const by = { kind: "pool-missing" as const, key: String(row.id) };
    detections.push({
      ...by,
      subjectId: row.id,
      severity: "warning",
      data: { poolName: row.name, lastSeenAt: iso(row.lastSeenAt) },
    });
    superseded.push({
      subjectType: "pool",
      subjectId: row.id,
      kinds: ["pool-degraded", ...LEAF_FAULT_KINDS],
      by,
    });
    for (const diskId of memberDiskIds(vdevs)) {
      superseded.push({
        subjectType: "disk",
        subjectId: diskId,
        kinds: ["disk-missing"],
        by,
      });
    }
  }

  const poolIds = current.map((scope) => scope.row.id);
  const latestScans = latestPoolEntries(poolIds, SCAN_FINISHED_EVENTS);
  const latestScrubs = latestPoolEntries(poolIds, ["scrub-finished"]);
  const history = leafErrorHistory();
  for (const scope of current) {
    const { row } = scope;
    const degraded = detectPoolDegraded(scope, missingDiskIds);
    const listedGuids = new Set(degraded?.listed.map((leaf) => leaf.guid));
    if (degraded) {
      detections.push(degraded.detection);
      const by = { kind: "pool-degraded" as const, key: String(row.id) };
      for (const leaf of degraded.listed) {
        superseded.push({
          subjectType: "pool",
          subjectId: row.id,
          kinds: LEAF_FAULT_KINDS,
          key: leafKey(row.id, leaf.guid),
          by,
        });
        if (leaf.diskId !== null) {
          superseded.push({
            subjectType: "disk",
            subjectId: leaf.diskId,
            kinds: ["disk-missing"],
            by,
          });
        }
      }
    }
    const unlisted = {
      ...scope,
      leaves: scope.leaves.filter((leaf) => !listedGuids.has(leaf.guid)),
    };
    detections.push(
      ...detectLeafErrors(
        scope,
        scope.vdevs.filter((leaf) => !listedGuids.has(leaf.guid)),
        history,
      ),
      ...detectLeafSlow(unlisted),
      ...detectPoolDataErrors(scope, latestScans.get(row.id)),
      ...detectScrubOverdue(scope, latestScrubs.get(row.id)),
    );
  }
  return { detections, superseded };
}
