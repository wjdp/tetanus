import { asc, inArray } from "drizzle-orm";
import type { DiaryEventType } from "#shared/diary";
import {
  FAULT_KIND_DEFINITIONS,
  FAULT_KINDS,
  FAULT_SEVERITY_RANK,
  type FaultData,
  type FaultKind,
  type FaultSeverity,
  type FaultState,
} from "#shared/faults";
import { healthStatus } from "#shared/smart/status";
import { db } from "~~/server/database/client";
import {
  diaryEntry,
  disk,
  fault,
  pool,
  smartReading,
} from "~~/server/database/schema";
import type { DiaryEntryRow } from "~~/server/services/diary";
import { listDisks } from "~~/server/services/disks";
import {
  applyDetections,
  detectFaults,
  type FaultRow,
  faultDetectionContext,
  identityConflictKey,
  LEFT_SERVICE_STATES,
  notifyFaultsChanged,
  poolSeverity,
  SCAN_FINISHED_EVENTS,
} from "~~/server/services/faults";
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
  "pool-state-changed",
  ...SCAN_FINISHED_EVENTS,
  "identity-conflict",
  "collector-status-changed",
  "fault-opened",
  "fault-state-changed",
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
const SETTABLE_STATES = new Set<FaultState>([
  "open",
  "acknowledged",
  "accepted",
]);

const iso = (date: Date | null) => date?.toISOString() ?? null;
const text = (value: unknown) => (typeof value === "string" ? value : "");
const identity = (kind: FaultKind, key: string) => `${kind}\u0000${key}`;

function isFaultKind(value: unknown): value is FaultKind {
  return FAULT_KINDS.includes(value as FaultKind);
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

  observe(opening: Opening, at: Date, { reopenOnRise = false } = {}) {
    const row = this.get(opening.kind, opening.key);
    if (!row) return this.open(opening, at);
    const isQuiet = row.state === "acknowledged" || row.state === "accepted";
    const rose =
      FAULT_SEVERITY_RANK[opening.severity] > FAULT_SEVERITY_RANK[row.severity];
    if (reopenOnRise && isQuiet && rose) this.setState(row, "open", "", at);
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

interface ReplayContext {
  replay: FaultReplay;
  poolNames: Map<number, string>;
  diskLastSeen: Map<number, Date | null>;
  outOfService: Set<number>;
}

function leaveOrReturnToService(
  context: ReplayContext,
  diskId: number,
  state: unknown,
  at: Date,
) {
  if (!LEFT_SERVICE_STATES.has(text(state))) {
    context.outOfService.delete(diskId);
    return;
  }
  context.outOfService.add(diskId);
  const { replay } = context;
  for (const row of replay.liveOf(["smart-attribute"], `${diskId}:`)) {
    replay.resolve(row, at);
  }
  replay.resolve(replay.get("smart-health-failed", String(diskId)), at);
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
      if (context.outOfService.has(diskId)) return;
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
      if (data.to === "missing") {
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
    case "identity-conflict": {
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

function replayPoolEntry(
  context: ReplayContext,
  entry: DiaryEntryRow,
  poolId: number,
) {
  const { replay } = context;
  const { data, at } = entry;
  const key = String(poolId);
  const poolName = context.poolNames.get(poolId) ?? null;
  if (entry.eventType === "pool-state-changed") {
    const state = text(data.to);
    if (state === "ONLINE") {
      replay.resolve(replay.get("pool-degraded", key), at);
      return;
    }
    replay.observe(
      {
        kind: "pool-degraded",
        key,
        subjectId: poolId,
        severity: poolSeverity(state),
        data: { state, poolName },
      },
      at,
      { reopenOnRise: true },
    );
    return;
  }
  if (!SCAN_FINISHED_EVENTS.includes(entry.eventType as never)) return;
  const errors = Number(data.errors);
  if (!(errors > 0)) {
    replay.resolve(replay.get("scan-errors", key), at);
    return;
  }
  replay.observe(
    {
      kind: "scan-errors",
      key,
      subjectId: poolId,
      severity: "error",
      data: { poolName, function: data.function, errors, finishedAt: iso(at) },
    },
    at,
  );
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

function dataFromKey(kind: FaultKind, key: string): FaultData {
  if (!COLLECTOR_VERSION_KINDS.includes(kind)) return {};
  return { version: key.slice(key.indexOf(":") + 1) };
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
          severity: kind === "collector-outdated" ? "warning" : "error",
          data: dataFromKey(kind, key),
        },
        at,
      );
      return;
    case "fault-state-changed": {
      const state = data.to as FaultState;
      if (row && SETTABLE_STATES.has(state)) {
        replay.setState(row, state, text(data.note), at);
      }
      return;
    }
    case "fault-resolved":
      replay.resolve(row, at, text(data.note));
      return;
  }
}

function replayEntry(context: ReplayContext, entry: DiaryEntryRow) {
  if (entry.eventType?.startsWith("fault-") && "faultId" in entry.data) {
    replayFaultEntry(context, entry);
    return;
  }
  if (entry.subjectId === null) return;
  if (entry.subjectType === "disk") {
    replayDiskEntry(context, entry, entry.subjectId);
  } else if (entry.subjectType === "pool") {
    replayPoolEntry(context, entry, entry.subjectId);
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
  if (context.outOfService.has(reading.diskId)) return;
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
    outOfService: new Set(),
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
