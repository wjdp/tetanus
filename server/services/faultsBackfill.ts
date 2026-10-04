import { asc, inArray } from "drizzle-orm";
import type { DiaryEventType } from "#shared/diary";
import { isHistoryState } from "#shared/disk";
import {
  FAULT_KIND_DEFINITIONS,
  FAULT_SEVERITIES,
  FAULT_SEVERITY_RANK,
  type FaultData,
  type FaultKind,
  type FaultSeverity,
  type FaultState,
  type FaultSubjectType,
  isFaultKind,
  type LeafCounts,
  type PoolDegradedLeaf,
} from "#shared/faults";
import { healthStatus } from "#shared/smart/status";
import { LEAF_VDEV_TYPES } from "#shared/zfsState";
import { db } from "~~/server/database/client";
import {
  diaryEntry,
  disk,
  fault,
  pool,
  smartReading,
  vdev,
} from "~~/server/database/schema";
import type { DiaryEntryRow } from "~~/server/services/diary";
import { listDisks } from "~~/server/services/disks";
import {
  applyDetections,
  detectFaults,
  type FaultRow,
  faultDetectionContext,
  identityConflictKey,
  notifyFaultsChanged,
} from "~~/server/services/faults";
import {
  accumulatedRise,
  addCounts,
  countsRose,
  hasLeafErrors,
  isHealthyLeafState,
  leafErrorsSeverity,
  leafKey,
  poolDegradedWorsened,
  poolSeverity,
  SCAN_FINISHED_EVENTS,
  worstSeverity,
} from "~~/server/services/poolFaults";
import { setFaultsBackfilledAt } from "~~/server/services/settings";

type ReplayedFault = Omit<FaultRow, "id">;

const REPLAYED_EVENTS = [
  "attribute-status-changed",
  "fault-accepted",
  "fault-acknowledged",
  "acceptance-superseded",
  "acknowledgement-superseded",
  "acceptance-cleared",
  "acknowledgement-cleared",
  "state-changed",
  "override-set",
  "disposed",
  "disposal-cleared",
  "pool-state-changed",
  "vdev-state-changed",
  "vdev-left",
  "leaf-errors-changed",
  "pool-data-errors-changed",
  ...SCAN_FINISHED_EVENTS,
  "pool-archived",
  "pool-unarchived",
  "identity-conflict",
  "collector-status-changed",
  "fault-opened",
  "fault-state-changed",
  "fault-severity-raised",
  "fault-resolved",
] as const satisfies readonly DiaryEventType[];

const ACCEPTANCE_STATES: Partial<Record<DiaryEventType, FaultState>> = {
  "fault-accepted": "accepted",
  "fault-acknowledged": "acknowledged",
  "acceptance-superseded": "open",
  "acknowledgement-superseded": "open",
  "acceptance-cleared": "open",
  "acknowledgement-cleared": "open",
};

const COLLECTOR_VERSION_KINDS: FaultKind[] = [
  "collector-incompatible",
  "collector-outdated",
];
const LEAF_FAULT_KINDS: FaultKind[] = ["leaf-errors", "leaf-slow"];
const WARNING_KINDS = new Set<FaultKind>([
  "collector-outdated",
  "pool-missing",
  "leaf-slow",
  "scrub-overdue",
  "pool-status",
  "scrub-paused",
  "scan-stalled",
  "vdev-unredundant",
]);
const SETTABLE_STATES = new Set<FaultState>([
  "open",
  "acknowledged",
  "accepted",
]);

const iso = (date: Date | null) => date?.toISOString() ?? null;
const text = (value: unknown) => (typeof value === "string" ? value : "");
const identity = (kind: FaultKind, key: string) => `${kind}\u0000${key}`;

function withoutAcknowledgedLevel({
  acknowledgedCounts: _counts,
  ...data
}: FaultData): FaultData {
  return data;
}

function withoutAcceptance({
  acceptanceKind: _kind,
  acceptedValue: _value,
  ...data
}: FaultData): FaultData {
  return data;
}

interface Opening {
  kind: FaultKind;
  key: string;
  subjectId: number;
  severity: FaultSeverity;
  data: FaultData;
}

class FaultReplay {
  readonly rows: ReplayedFault[] = [];
  private readonly live = new Map<string, ReplayedFault>();

  get(kind: FaultKind, key: string) {
    return this.live.get(identity(kind, key));
  }

  liveOfSubject(subjectType: FaultSubjectType, subjectId: number) {
    return [...this.live.values()].filter(
      (row) => row.subjectType === subjectType && row.subjectId === subjectId,
    );
  }

  liveOf(kinds: FaultKind[], keyPrefix: string) {
    return [...this.live.values()].filter(
      (row) => kinds.includes(row.kind) && row.key.startsWith(keyPrefix),
    );
  }

  open({ kind, key, subjectId, severity, data }: Opening, at: Date) {
    const existing = this.get(kind, key);
    if (existing) return existing;
    const definition = FAULT_KIND_DEFINITIONS[kind];
    const row: ReplayedFault = {
      kind,
      category: definition.category,
      subjectType: definition.subjectType,
      subjectId,
      key,
      severity,
      data,
      openedAt: at,
      lastSeenAt: at,
      resolvedAt: null,
      state: "open",
      stateChangedAt: at,
      note: "",
    };
    this.rows.push(row);
    this.live.set(identity(kind, key), row);
    return row;
  }

  observe(
    opening: Opening,
    at: Date,
    {
      reopenOnRise = false,
      reopenWhen,
    }: {
      reopenOnRise?: boolean;
      reopenWhen?: (previous: FaultData) => boolean;
    } = {},
  ) {
    const row = this.get(opening.kind, opening.key);
    if (!row) return this.open(opening, at);
    const isQuiet = row.state === "acknowledged" || row.state === "accepted";
    const rose =
      FAULT_SEVERITY_RANK[opening.severity] > FAULT_SEVERITY_RANK[row.severity];
    const worsened = (reopenOnRise && rose) || reopenWhen?.(row.data) === true;
    if (isQuiet && worsened) {
      this.setState(row, "open", "", at);
      row.data = withoutAcknowledgedLevel(row.data);
    }
    row.severity = opening.severity;
    row.data = { ...row.data, ...opening.data };
    row.lastSeenAt = at;
    return row;
  }

  setState(row: ReplayedFault, state: FaultState, note: string, at: Date) {
    if (row.state === state && row.note === note) return;
    row.state = state;
    row.note = note;
    row.stateChangedAt = at;
  }

  resolve(row: ReplayedFault | undefined, at: Date, note = row?.note ?? "") {
    if (!row) return;
    row.state = "resolved";
    row.resolvedAt = at;
    row.stateChangedAt = at;
    row.note = note;
    this.live.delete(identity(row.kind, row.key));
  }
}

interface ReplayedLeaf {
  guid: string;
  name: string;
  role: string;
  type: string;
  diskId: number | null;
  poolId: number;
}

interface PoolReplayState {
  state: string;
  failedLeaves: Map<string, PoolDegradedLeaf>;
  dataErrors: number;
  scanErrors: number;
}

interface ReplayContext {
  replay: FaultReplay;
  poolNames: Map<number, string>;
  diskLastSeen: Map<number, Date | null>;
  historyDiskIds: Set<number>;
  disposedDiskIds: Set<number>;
  leaves: Map<number, ReplayedLeaf>;
  leafCounts: Map<string, LeafCounts>;
  pools: Map<number, PoolReplayState>;
  archivedPoolIds: Set<number>;
}

// `sold` left the override set for a disposal record (040); diary entries
// written before that still take the disk out of service.
const LEGACY_SOLD_OVERRIDE = "sold";

function isOutOfServiceState(state: unknown) {
  return isHistoryState(state) || state === LEGACY_SOLD_OVERRIDE;
}

function isOutOfService(context: ReplayContext, diskId: number) {
  return (
    context.historyDiskIds.has(diskId) || context.disposedDiskIds.has(diskId)
  );
}

function resolveSmartFaults(context: ReplayContext, diskId: number, at: Date) {
  const { replay } = context;
  for (const row of replay.liveOf(["smart-attribute"], `${diskId}:`)) {
    replay.resolve(row, at);
  }
  replay.resolve(replay.get("smart-health-failed", String(diskId)), at);
}

function leaveOrReturnToService(
  context: ReplayContext,
  diskId: number,
  state: unknown,
  at: Date,
) {
  if (!isOutOfServiceState(state)) {
    context.historyDiskIds.delete(diskId);
    return;
  }
  context.historyDiskIds.add(diskId);
  resolveSmartFaults(context, diskId, at);
}

function missingData(context: ReplayContext, diskId: number, at: Date) {
  const lastSeenAt = context.diskLastSeen.get(diskId) ?? null;
  return {
    lastSeenAt: lastSeenAt && lastSeenAt <= at ? iso(lastSeenAt) : null,
  };
}

function replayDiskEntry(
  context: ReplayContext,
  entry: DiaryEntryRow,
  diskId: number,
) {
  const { replay } = context;
  const { data, at } = entry;
  const eventType = entry.eventType as DiaryEventType;
  const acceptanceState = ACCEPTANCE_STATES[eventType];
  if (acceptanceState) {
    const row = replay.get("smart-attribute", `${diskId}:${text(data.attrId)}`);
    if (!row) return;
    if (acceptanceState === "open") {
      row.data = withoutAcceptance(row.data);
      replay.setState(row, "open", "", at);
      return;
    }
    row.data = {
      ...row.data,
      acceptanceKind: eventType === "fault-accepted" ? "accept" : "acknowledge",
      acceptedValue: data.acceptedValue,
    };
    replay.setState(row, acceptanceState, text(data.note), at);
    return;
  }
  switch (eventType) {
    case "attribute-status-changed": {
      const key = `${diskId}:${text(data.attrId)}`;
      if (data.to === "passed") {
        replay.resolve(replay.get("smart-attribute", key), at);
        return;
      }
      if (isOutOfService(context, diskId)) return;
      if (data.to !== "warning" && data.to !== "failed") return;
      replay.observe(
        {
          kind: "smart-attribute",
          key,
          subjectId: diskId,
          severity: data.to === "failed" ? "error" : "warning",
          data: { attrId: data.attrId, name: data.name, value: data.value },
        },
        at,
      );
      return;
    }
    case "state-changed": {
      leaveOrReturnToService(context, diskId, data.to, at);
      if (data.to === "missing" && !context.disposedDiskIds.has(diskId)) {
        replay.open(
          {
            kind: "disk-missing",
            key: String(diskId),
            subjectId: diskId,
            severity: "error",
            data: missingData(context, diskId, at),
          },
          at,
        );
      } else if (data.from === "missing") {
        replay.resolve(replay.get("disk-missing", String(diskId)), at);
      }
      return;
    }
    case "override-set": {
      leaveOrReturnToService(context, diskId, data.to, at);
      if (data.to) {
        replay.resolve(replay.get("disk-missing", String(diskId)), at);
      }
      return;
    }
    case "disposed": {
      context.disposedDiskIds.add(diskId);
      resolveSmartFaults(context, diskId, at);
      replay.resolve(replay.get("disk-missing", String(diskId)), at);
      for (const row of replay.liveOf(["identity-conflict"], `${diskId}:`)) {
        replay.resolve(row, at);
      }
      return;
    }
    case "disposal-cleared": {
      context.disposedDiskIds.delete(diskId);
      return;
    }
    case "identity-conflict": {
      if (context.disposedDiskIds.has(diskId)) return;
      replay.observe(
        {
          kind: "identity-conflict",
          key: identityConflictKey(diskId, data.diskIds),
          subjectId: diskId,
          severity: "error",
          data: { diskIds: data.diskIds, conflictAt: iso(at) },
        },
        at,
      );
      return;
    }
  }
}

function poolState(context: ReplayContext, poolId: number) {
  let state = context.pools.get(poolId);
  if (!state) {
    state = {
      state: "ONLINE",
      failedLeaves: new Map(),
      dataErrors: 0,
      scanErrors: 0,
    };
    context.pools.set(poolId, state);
  }
  return state;
}

const ZERO_COUNTS: LeafCounts = { read: 0, write: 0, checksum: 0 };

function replayPoolDegraded(context: ReplayContext, poolId: number, at: Date) {
  const { replay } = context;
  const key = String(poolId);
  const { state, failedLeaves } = poolState(context, poolId);
  if (state === "ONLINE" && failedLeaves.size === 0) {
    replay.resolve(replay.get("pool-degraded", key), at);
    return;
  }
  const leaves = [...failedLeaves.values()];
  const severity = worstSeverity([
    ...(state === "ONLINE" ? [] : [poolSeverity(state)]),
    ...leaves.map((leaf) => poolSeverity(leaf.state)),
  ]);
  replay.observe(
    {
      kind: "pool-degraded",
      key,
      subjectId: poolId,
      severity,
      data: { state, poolName: context.poolNames.get(poolId) ?? null, leaves },
    },
    at,
    {
      reopenOnRise: true,
      reopenWhen: (previous) => poolDegradedWorsened(leaves, previous.leaves),
    },
  );
}

function replayVdevEntry(context: ReplayContext, entry: DiaryEntryRow) {
  if (entry.subjectId === null) return;
  const leaf = context.leaves.get(entry.subjectId);
  if (entry.eventType === "vdev-left" && leaf) {
    const { replay } = context;
    for (const kind of LEAF_FAULT_KINDS) {
      replay.resolve(
        replay.get(kind, leafKey(leaf.poolId, leaf.guid)),
        entry.at,
      );
    }
    return;
  }
  if (entry.eventType !== "vdev-state-changed") return;
  if (!leaf || !LEAF_VDEV_TYPES.has(leaf.type)) return;
  const { replay } = context;
  const { failedLeaves } = poolState(context, leaf.poolId);
  const state = text(entry.data.to);
  if (isHealthyLeafState(state, leaf.role)) {
    failedLeaves.delete(leaf.guid);
  } else {
    failedLeaves.set(leaf.guid, {
      vdevGuid: leaf.guid,
      name: leaf.name,
      state,
      role: leaf.role,
      diskId: leaf.diskId,
      diskMissing: false,
      ...(context.leafCounts.get(leaf.guid) ?? ZERO_COUNTS),
    });
    for (const kind of LEAF_FAULT_KINDS) {
      replay.resolve(
        replay.get(kind, leafKey(leaf.poolId, leaf.guid)),
        entry.at,
      );
    }
  }
  replayPoolDegraded(context, leaf.poolId, entry.at);
}

function countsOf(value: unknown): LeafCounts {
  const counts = (value ?? {}) as Partial<LeafCounts>;
  return {
    read: Number(counts.read) || 0,
    write: Number(counts.write) || 0,
    checksum: Number(counts.checksum) || 0,
  };
}

function replayLeafErrors(
  context: ReplayContext,
  entry: DiaryEntryRow,
  poolId: number,
) {
  const { replay } = context;
  const { data, at } = entry;
  const vdevGuid = text(data.vdevGuid);
  const counts = countsOf(data.to);
  const previous = countsOf(data.from);
  context.leafCounts.set(vdevGuid, counts);
  const failed = poolState(context, poolId).failedLeaves.get(vdevGuid);
  if (failed) {
    Object.assign(failed, counts);
    replayPoolDegraded(context, poolId, at);
    return;
  }
  const key = leafKey(poolId, vdevGuid);
  const live = replay.get("leaf-errors", key);
  const resolvedBefore = replay.rows.some(
    (row) => row.kind === "leaf-errors" && row.key === key,
  );
  const rise = accumulatedRise(
    { ...(live || resolvedBefore ? previous : ZERO_COUNTS), slowIos: 0 },
    [{ ...counts, slowIos: 0 }],
  );
  const total = live ? addCounts(countsOf(live.data.total), rise) : rise;
  if (!hasLeafErrors(total)) return;
  replay.observe(
    {
      kind: "leaf-errors",
      key,
      subjectId: poolId,
      severity: leafErrorsSeverity(data.role),
      data: {
        poolName: context.poolNames.get(poolId) ?? null,
        vdevGuid,
        name: data.leaf,
        role: data.role ?? null,
        diskId: data.diskId ?? null,
        ...counts,
        total,
      },
    },
    at,
    {
      reopenWhen: (previousData) =>
        countsRose(
          total,
          previousData.acknowledgedCounts ?? previousData.total,
        ),
    },
  );
}

function replayPoolDataErrors(
  context: ReplayContext,
  poolId: number,
  at: Date,
  scan?: { function: unknown; finishedAt: string | null },
) {
  const { replay } = context;
  const key = String(poolId);
  const state = poolState(context, poolId);
  if (state.dataErrors <= 0 && state.scanErrors <= 0) {
    replay.resolve(replay.get("pool-data-errors", key), at);
    return;
  }
  const dataErrors = state.dataErrors;
  replay.observe(
    {
      kind: "pool-data-errors",
      key,
      subjectId: poolId,
      severity: "error",
      data: {
        poolName: context.poolNames.get(poolId) ?? null,
        dataErrors,
        scanErrors: state.scanErrors,
        ...(scan ?? {}),
      },
    },
    at,
    {
      reopenWhen: (previous) =>
        dataErrors > Number(previous.dataErrors ?? 0) ||
        (scan !== undefined && state.scanErrors > 0),
    },
  );
}

function replayPoolEntry(
  context: ReplayContext,
  entry: DiaryEntryRow,
  poolId: number,
) {
  const { data, at } = entry;
  switch (entry.eventType) {
    case "pool-state-changed":
      poolState(context, poolId).state = text(data.to);
      replayPoolDegraded(context, poolId, at);
      return;
    case "leaf-errors-changed":
      replayLeafErrors(context, entry, poolId);
      return;
    case "pool-data-errors-changed":
      poolState(context, poolId).dataErrors = Number(data.to) || 0;
      replayPoolDataErrors(context, poolId, at);
      return;
  }
  if (!SCAN_FINISHED_EVENTS.includes(entry.eventType as never)) return;
  const state = poolState(context, poolId);
  state.scanErrors = Number(data.errors) || 0;
  // A clean scan is the only trail of data errors clearing; the final sync
  // reopens from Pool.errors if they did not.
  if (state.scanErrors === 0) state.dataErrors = 0;
  replayPoolDataErrors(context, poolId, at, {
    function: state.scanErrors > 0 ? data.function : null,
    finishedAt: state.scanErrors > 0 ? iso(at) : null,
  });
}

function replayHostEntry(
  context: ReplayContext,
  entry: DiaryEntryRow,
  hostId: number,
) {
  if (entry.eventType !== "collector-status-changed") return;
  const { replay } = context;
  const { data, at } = entry;
  const version = text(data.version);
  const key = `${hostId}:${version}`;
  const kind: FaultKind | null =
    data.to === "incompatible"
      ? "collector-incompatible"
      : data.to === "outdated"
        ? "collector-outdated"
        : null;
  for (const row of replay.liveOf(COLLECTOR_VERSION_KINDS, `${hostId}:`)) {
    if (row.kind !== kind || row.key !== key) replay.resolve(row, at);
  }
  if (!kind || !version) return;
  replay.open(
    {
      kind,
      key,
      subjectId: hostId,
      severity: kind === "collector-outdated" ? "warning" : "error",
      data:
        kind === "collector-incompatible"
          ? { version, minVersion: data.minVersion }
          : { version },
    },
    at,
  );
}

// Entries since severity was written carry it; older ones fall back to the
// kind's usual severity.
function openedSeverity(kind: FaultKind, recorded: unknown): FaultSeverity {
  if (FAULT_SEVERITIES.includes(recorded as FaultSeverity)) {
    return recorded as FaultSeverity;
  }
  return WARNING_KINDS.has(kind) ? "warning" : "error";
}

function dataFromKey(kind: FaultKind, key: string): FaultData {
  const afterColon = key.slice(key.indexOf(":") + 1);
  if (COLLECTOR_VERSION_KINDS.includes(kind)) return { version: afterColon };
  if (LEAF_FAULT_KINDS.includes(kind) || kind === "vdev-unredundant") {
    return { vdevGuid: afterColon };
  }
  if (kind === "pool-capacity" && key.includes(":")) {
    return { vdevGuid: afterColon };
  }
  if (kind === "pool-status") return { msgid: afterColon };
  return {};
}

// The fault trail sync writes since faults were stored: covers kinds with no
// other trail (collector-silent), acknowledgements, and makes a re-run
// reproduce the rows a previous backfill's sync opened.
function replayFaultEntry(context: ReplayContext, entry: DiaryEntryRow) {
  const { replay } = context;
  const { data, at } = entry;
  const kind = data.kind;
  const key = text(data.key);
  if (!isFaultKind(kind) || kind === "smart-attribute" || !key) return;
  const row = replay.get(kind, key);
  switch (entry.eventType) {
    case "fault-opened":
      if (row || entry.subjectId === null) return;
      replay.open(
        {
          kind,
          key,
          subjectId: entry.subjectId,
          severity: openedSeverity(kind, data.severity),
          data: dataFromKey(kind, key),
        },
        at,
      );
      return;
    case "fault-state-changed": {
      const state = data.to as FaultState;
      if (row && SETTABLE_STATES.has(state)) {
        replay.setState(row, state, text(data.note), at);
        if (kind === "leaf-errors") setAcknowledgedLevel(row, state);
      }
      return;
    }
    case "fault-severity-raised":
      if (row && FAULT_SEVERITIES.includes(data.severity as FaultSeverity)) {
        row.severity = data.severity as FaultSeverity;
      }
      return;
    case "fault-resolved":
      replay.resolve(row, at, text(data.note));
      return;
  }
}

function setAcknowledgedLevel(row: ReplayedFault, state: FaultState) {
  row.data = withoutAcknowledgedLevel(row.data);
  if (state === "open") return;
  row.data.acknowledgedCounts = countsOf(row.data.total);
}

// An archived pool's entries open nothing, as its detectors skip it.
function replayArchiveEntry(context: ReplayContext, entry: DiaryEntryRow) {
  const poolId = entry.subjectId as number;
  if (entry.eventType === "pool-unarchived") {
    context.archivedPoolIds.delete(poolId);
    return;
  }
  context.archivedPoolIds.add(poolId);
  const { replay } = context;
  for (const row of replay.liveOfSubject("pool", poolId)) {
    replay.resolve(row, entry.at);
  }
}

function entryPoolId(context: ReplayContext, entry: DiaryEntryRow) {
  if (entry.subjectId === null) return null;
  if (entry.subjectType === "pool") return entry.subjectId;
  if (entry.subjectType === "vdev") {
    return context.leaves.get(entry.subjectId)?.poolId ?? null;
  }
  return null;
}

function replayEntry(context: ReplayContext, entry: DiaryEntryRow) {
  if (entry.eventType?.startsWith("fault-") && "faultId" in entry.data) {
    replayFaultEntry(context, entry);
    return;
  }
  if (entry.subjectId === null) return;
  if (
    entry.eventType === "pool-archived" ||
    entry.eventType === "pool-unarchived"
  ) {
    replayArchiveEntry(context, entry);
    return;
  }
  const poolId = entryPoolId(context, entry);
  if (poolId !== null && context.archivedPoolIds.has(poolId)) return;
  if (entry.subjectType === "disk") {
    replayDiskEntry(context, entry, entry.subjectId);
  } else if (entry.subjectType === "pool") {
    replayPoolEntry(context, entry, entry.subjectId);
  } else if (entry.subjectType === "vdev") {
    replayVdevEntry(context, entry);
  } else if (entry.subjectType === "host") {
    replayHostEntry(context, entry, entry.subjectId);
  }
}

type SmartReadingRow = Pick<
  typeof smartReading.$inferSelect,
  "diskId" | "takenAt" | "smartPassed" | "exitStatus"
>;

function replayReading(context: ReplayContext, reading: SmartReadingRow) {
  const { replay } = context;
  const key = String(reading.diskId);
  const { takenAt } = reading;
  if (healthStatus(reading.smartPassed, reading.exitStatus) !== "failed") {
    replay.resolve(replay.get("smart-health-failed", key), takenAt);
    return;
  }
  if (isOutOfService(context, reading.diskId)) return;
  replay.observe(
    {
      kind: "smart-health-failed",
      key,
      subjectId: reading.diskId,
      severity: "error",
      data: { readingAt: iso(takenAt) },
    },
    takenAt,
  );
}

type TimelineItem =
  | { at: Date; order: number; entry: DiaryEntryRow }
  | { at: Date; order: number; reading: SmartReadingRow };

function timeline(): TimelineItem[] {
  const entries = db
    .select()
    .from(diaryEntry)
    .where(inArray(diaryEntry.eventType, [...REPLAYED_EVENTS]))
    .orderBy(asc(diaryEntry.at), asc(diaryEntry.id))
    .all()
    .map((entry, order) => ({ at: entry.at, order, entry }));
  const readings = db
    .select({
      diskId: smartReading.diskId,
      takenAt: smartReading.takenAt,
      smartPassed: smartReading.smartPassed,
      exitStatus: smartReading.exitStatus,
    })
    .from(smartReading)
    .orderBy(asc(smartReading.takenAt), asc(smartReading.id))
    .all()
    .map((reading, index) => ({
      at: reading.takenAt,
      order: entries.length + index,
      reading,
    }));
  return [...entries, ...readings].sort(
    (a, b) => a.at.getTime() - b.at.getTime() || a.order - b.order,
  );
}

export function replayFaultHistory(): ReplayedFault[] {
  const context: ReplayContext = {
    replay: new FaultReplay(),
    poolNames: new Map(
      db
        .select({ id: pool.id, name: pool.name })
        .from(pool)
        .all()
        .map((row) => [row.id, row.name]),
    ),
    diskLastSeen: new Map(
      db
        .select({ id: disk.id, lastSeenAt: disk.lastSeenAt })
        .from(disk)
        .all()
        .map((row) => [row.id, row.lastSeenAt]),
    ),
    historyDiskIds: new Set(),
    disposedDiskIds: new Set(),
    leaves: new Map(
      db
        .select({
          id: vdev.id,
          guid: vdev.guid,
          name: vdev.name,
          role: vdev.role,
          type: vdev.type,
          diskId: vdev.diskId,
          poolId: vdev.poolId,
        })
        .from(vdev)
        .all()
        .map(({ id, ...leaf }) => [id, leaf]),
    ),
    leafCounts: new Map(),
    pools: new Map(),
    archivedPoolIds: new Set(),
  };
  for (const item of timeline()) {
    if ("entry" in item) replayEntry(context, item.entry);
    else replayReading(context, item.reading);
  }
  return context.replay.rows;
}

const INSERT_CHUNK = 500;

export interface FaultsBackfillSummary {
  replayed: number;
  total: number;
  live: number;
}

export async function backfillFaults(
  now = new Date(),
): Promise<FaultsBackfillSummary> {
  const disks = await listDisks(now);
  const summary = db.transaction(() => {
    db.delete(fault).run();
    const replayed = replayFaultHistory().sort(
      (a, b) => a.openedAt.getTime() - b.openedAt.getTime(),
    );
    for (let start = 0; start < replayed.length; start += INSERT_CHUNK) {
      db.insert(fault)
        .values(replayed.slice(start, start + INSERT_CHUNK))
        .run();
    }
    applyDetections(detectFaults(faultDetectionContext(now, disks)), now);
    setFaultsBackfilledAt(now);
    const rows = db.select({ state: fault.state }).from(fault).all();
    return {
      replayed: replayed.length,
      total: rows.length,
      live: rows.filter((row) => row.state !== "resolved").length,
    };
  });
  notifyFaultsChanged();
  return summary;
}
