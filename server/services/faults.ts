import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";
import { COLLECTOR_VERSION, MIN_COLLECTOR_VERSION } from "#shared/collector";
import { describeDisk, isDisposed, isHistoryState } from "#shared/disk";
import { hostPath } from "#shared/entityPaths";
import {
  allowedActions,
  DISK_NAMING_FAULT_KINDS,
  FAULT_KIND_DEFINITIONS,
  FAULT_SEVERITY_RANK,
  FAULT_STATES,
  type FaultAction,
  type FaultCounts,
  type FaultData,
  type FaultKind,
  type FaultSeverity,
  type FaultState,
  type FaultSubject,
  type FaultSubjectType,
  type FaultsResponse,
  type FaultView,
  faultTitle,
  namedDiskIds,
} from "#shared/faults";
import { type CadenceOverrides, isHostSilent } from "#shared/hostFreshness";
import { unsupportedTools } from "#shared/hostTools";
import { replicationLabel } from "#shared/replications";
import type { FaultsQuery } from "#shared/schemas/faults";
import {
  type AttributeStatus,
  healthStatus,
  overlayStatus,
} from "#shared/smart/status";
import type { SubstituteSource } from "#shared/smart/substituteDefects";
import { db } from "~~/server/database/client";
import {
  dataset,
  diaryEntry,
  disk,
  fault,
  host,
  pool,
  replication,
} from "~~/server/database/schema";
import {
  acceptFault,
  activeAcceptances,
  clearAcceptance,
} from "~~/server/services/acceptance";
import { addAutoEvent } from "~~/server/services/diary";
import {
  type DiskSummary,
  describeDisks,
  listDisks,
} from "~~/server/services/disks";
import { detectErrorLogGrowth } from "~~/server/services/errorLogFaults";
import {
  detectHeliumTripped,
  detectSmartCountersReset,
} from "~~/server/services/farmFaults";
import { type HostWithRuns, listHosts } from "~~/server/services/hosts";
import { detectInterfaceErrors } from "~~/server/services/interfaceFaults";
import { detectPoolFaults } from "~~/server/services/poolFaults";
import { detectReplicationFaults } from "~~/server/services/replications/faults";
import { detectSelfTestFailed } from "~~/server/services/selfTestFaults";
import {
  type AttributeTrend,
  attributesOfReading,
  attributeTrend,
  latestReading,
  substituteAttributes,
} from "~~/server/services/smart";
import { detectSmartUnavailable } from "~~/server/services/smartUnavailableFaults";
import { detectTemperatureHigh } from "~~/server/services/temperatureFaults";
import { poolPaths } from "~~/server/services/zfs/paths";
import { useSseEvent } from "~~/server/sse";
import { collectorCadences } from "~~/server/utils/demo";
import { notFound, ServiceError } from "~~/server/utils/serviceError";

export type FaultRow = typeof fault.$inferSelect;

export interface Detection {
  kind: FaultKind;
  key: string;
  subjectId: number;
  severity: FaultSeverity;
  data: FaultData;
  state?: FaultState;
  reopen?: (previous: FaultData) => boolean;
  carry?: (previous: FaultData) => FaultData;
}

export interface FaultReference {
  kind: FaultKind;
  key: string;
}

// A fault that restates another's observation (046 §Folding): not opened, and
// a live one resolves naming the fault that now carries it.
export interface Supersession {
  subjectType: FaultSubjectType;
  subjectId: number;
  kinds: FaultKind[];
  key?: string;
  by: FaultReference;
}

// A subject the detectors no longer watch: its live faults resolve with the
// reason, as resolvePoolFaults does for an archived pool.
export interface Withdrawal {
  subjectType: FaultSubjectType;
  subjectId: number;
  reason: string;
}

export interface FaultScan {
  detections: Detection[];
  superseded: Supersession[];
  withdrawn: Withdrawal[];
}

export interface DetectionContext {
  now: Date;
  disks: DiskSummary[];
  hosts: HostWithRuns[];
  cadences: CadenceOverrides;
}

const ACCEPTANCE_STATE = {
  accepted: "accepted",
  acknowledged: "acknowledged",
} as const;

const iso = (date: Date | null) => date?.toISOString() ?? null;

export const DISPOSED_FAULT_REASON = "disposed";

function inService(disks: DiskSummary[]) {
  return disks.filter((row) => !isHistoryState(row.state) && !isDisposed(row));
}

function withdrawDisposedDisks({ disks }: DetectionContext): Withdrawal[] {
  return disks.filter(isDisposed).map((row) => ({
    subjectType: "disk",
    subjectId: row.id,
    reason: DISPOSED_FAULT_REASON,
  }));
}

interface FaultingAttribute {
  attrId: string;
  name: string;
  status: AttributeStatus;
  transformedValue: number;
  trend?: AttributeTrend;
  source?: SubstituteSource;
}

function faultingAttributes(
  diskId: number,
  readingId: number,
): FaultingAttribute[] {
  const evaluated = attributesOfReading(readingId)
    .filter((attribute) => attribute.status !== "passed")
    .map(
      (attribute): FaultingAttribute => ({
        ...attribute,
        trend: attributeTrend(diskId, attribute),
      }),
    );
  const substitutes = substituteAttributes(diskId, readingId).filter(
    (attribute) => attribute.status !== "passed",
  );
  return [...evaluated, ...substitutes];
}

function detectSmartAttributes({ disks }: DetectionContext): Detection[] {
  return inService(disks).flatMap((row) => {
    const reading = latestReading(row.id);
    if (!reading) return [];
    const active = activeAcceptances(row.id);
    return faultingAttributes(row.id, reading.id).map(
      (attribute): Detection => {
        const acceptance = active.get(attribute.attrId);
        const display = overlayStatus(
          attribute.status,
          attribute.transformedValue,
          acceptance,
        );
        const covered = display === "accepted" || display === "acknowledged";
        return {
          kind: "smart-attribute",
          key: `${row.id}:${attribute.attrId}`,
          subjectId: row.id,
          severity: attribute.status === "failed" ? "error" : "warning",
          state: covered ? ACCEPTANCE_STATE[display] : "open",
          data: {
            attrId: attribute.attrId,
            name: attribute.name,
            value: attribute.transformedValue,
            ...(attribute.source
              ? { source: attribute.source }
              : { trend: attribute.trend }),
            ...(acceptance && covered
              ? {
                  acceptanceKind: acceptance.kind,
                  acceptedValue: acceptance.acceptedValue,
                }
              : {}),
          },
        };
      },
    );
  });
}

function detectHealthFailed({ disks }: DetectionContext): Detection[] {
  return inService(disks).flatMap((row) => {
    const reading = latestReading(row.id);
    if (!reading) return [];
    if (healthStatus(reading.smartPassed, reading.exitStatus) !== "failed") {
      return [];
    }
    return {
      kind: "smart-health-failed",
      key: String(row.id),
      subjectId: row.id,
      severity: "error",
      data: { readingAt: iso(reading.takenAt) },
    };
  });
}

function detectMissing(
  { disks }: DetectionContext,
  suppressedDiskIds: Set<number>,
): Detection[] {
  return disks
    .filter(
      (row) =>
        row.state === "missing" &&
        !isDisposed(row) &&
        !suppressedDiskIds.has(row.id),
    )
    .map((row) => ({
      kind: "disk-missing",
      key: String(row.id),
      subjectId: row.id,
      severity: "error",
      data: { lastSeenAt: iso(row.lastSeenAt) },
    }));
}

function wasAcknowledgedSince(kind: FaultKind, key: string, at: Date) {
  return db
    .select({ resolvedAt: fault.resolvedAt })
    .from(fault)
    .where(
      and(
        eq(fault.kind, kind),
        eq(fault.key, key),
        eq(fault.state, "resolved"),
      ),
    )
    .all()
    .some((row) => row.resolvedAt !== null && row.resolvedAt >= at);
}

export function identityConflictKey(subjectId: number, diskIds: unknown) {
  const ids = Array.isArray(diskIds) ? diskIds.map(Number) : [];
  return `${subjectId}:${[...ids].sort((a, b) => a - b).join(",")}`;
}

const otherDiskIds = (diskIds: unknown) =>
  Array.isArray(diskIds) ? diskIds.slice(1).map(Number) : [];

function detectIdentityConflicts({ disks }: DetectionContext): Detection[] {
  const disposedDiskIds = new Set(disks.filter(isDisposed).map(({ id }) => id));
  const entries = db
    .select()
    .from(diaryEntry)
    .where(eq(diaryEntry.eventType, "identity-conflict"))
    .orderBy(desc(diaryEntry.at), desc(diaryEntry.id))
    .all();
  const byKey = new Map<string, Detection>();
  for (const entry of entries) {
    if (entry.subjectId === null) continue;
    if (disposedDiskIds.has(entry.subjectId)) continue;
    const key = identityConflictKey(entry.subjectId, entry.data.diskIds);
    if (byKey.has(key)) continue;
    if (wasAcknowledgedSince("identity-conflict", key, entry.at)) continue;
    byKey.set(key, {
      kind: "identity-conflict",
      key,
      subjectId: entry.subjectId,
      severity: "error",
      data: {
        diskIds: entry.data.diskIds,
        others: describeDisks(otherDiskIds(entry.data.diskIds)),
        conflictAt: iso(entry.at),
      },
    });
  }
  return [...byKey.values()];
}

type PoolRow = typeof pool.$inferSelect;

function lastOkAt(row: HostWithRuns) {
  const times = Object.values(row.lastRuns)
    .filter((run) => run.ok)
    .map((run) => run.receivedAt.getTime());
  return times.length > 0 ? new Date(Math.max(...times)) : null;
}

function detectCollectorSilent({
  hosts,
  now,
  cadences,
}: DetectionContext): Detection[] {
  return hosts.flatMap((row) => {
    if (!isHostSilent(row, now.getTime(), cadences)) return [];
    return {
      kind: "collector-silent",
      key: String(row.id),
      subjectId: row.id,
      severity: "error",
      data: { lastOkAt: iso(lastOkAt(row) ?? row.lastSeenAt) },
    };
  });
}

function detectCollectorVersion({ hosts }: DetectionContext): Detection[] {
  return hosts.flatMap((row): Detection[] => {
    const version = row.collectorVersion;
    if (!version) return [];
    if (row.collectorStatus === "incompatible") {
      return [
        {
          kind: "collector-incompatible",
          key: `${row.id}:${version}`,
          subjectId: row.id,
          severity: "error",
          data: { version, minVersion: MIN_COLLECTOR_VERSION },
        },
      ];
    }
    if (row.collectorStatus === "outdated") {
      return [
        {
          kind: "collector-outdated",
          key: `${row.id}:${version}`,
          subjectId: row.id,
          severity: "warning",
          data: { version, currentVersion: COLLECTOR_VERSION },
        },
      ];
    }
    return [];
  });
}

function detectHostDegraded({ hosts }: DetectionContext): Detection[] {
  return hosts.flatMap((row) =>
    unsupportedTools(row.toolVersions).map(
      (unsupported): Detection => ({
        kind: "host-degraded",
        key: `${row.id}:${unsupported.tool}:${unsupported.version}`,
        subjectId: row.id,
        severity: "warning",
        data: { ...unsupported },
      }),
    ),
  );
}

export function detectFaults(context: DetectionContext): FaultScan {
  const silent = detectCollectorSilent(context);
  const pools = detectPoolFaults(context);
  const replications = detectReplicationFaults(context.now);
  const suppressedDiskIds = new Set(
    pools.superseded
      .filter((supersession) => supersession.subjectType === "disk")
      .map((supersession) => supersession.subjectId),
  );
  return {
    detections: [
      ...detectSmartAttributes(context),
      ...detectHealthFailed(context),
      ...detectTemperatureHigh(context),
      ...detectSmartCountersReset(context),
      ...detectHeliumTripped(context),
      ...detectSelfTestFailed(context),
      ...detectSmartUnavailable(context),
      ...detectErrorLogGrowth(context),
      ...detectInterfaceErrors(context),
      ...detectMissing(context, suppressedDiskIds),
      ...detectIdentityConflicts(context),
      ...pools.detections,
      ...replications.detections,
      ...silent,
      ...detectCollectorVersion(context),
      ...detectHostDegraded(context),
    ],
    superseded: [...pools.superseded, ...replications.superseded],
    withdrawn: [...withdrawDisposedDisks(context), ...replications.withdrawn],
  };
}

// SMART attribute faults have their own diary trail (042's acceptance
// events, attribute-status-changed); health failure shows as
// smart-status-changed.
const DIARY_SILENT_KINDS = new Set<FaultKind>([
  "smart-attribute",
  "smart-health-failed",
]);

function writeFaultEvent(
  row: FaultRow,
  eventType:
    | "fault-opened"
    | "fault-resolved"
    | "fault-state-changed"
    | "fault-severity-raised",
  from: FaultState | null,
  at: Date,
  extra: FaultData = {},
) {
  const title = faultTitle(row, at.getTime());
  const prefix = {
    "fault-opened": "fault",
    "fault-resolved": "fault resolved",
    "fault-state-changed": `fault ${row.state}`,
    "fault-severity-raised": `fault raised to ${row.severity}`,
  }[eventType];
  addAutoEvent({
    subjectType: row.subjectType,
    subjectId: row.subjectId,
    eventType,
    title: `${prefix}: ${title}`,
    data: {
      faultId: row.id,
      kind: row.kind,
      key: row.key,
      from,
      to: row.state,
      note: row.note,
      ...extra,
    },
    at,
  });
}

function liveRows(): FaultRow[] {
  return db.select().from(fault).where(isNull(fault.resolvedAt)).all();
}

const identity = (kind: FaultKind, key: string) => `${kind}\u0000${key}`;

function isSeverityRise(from: FaultSeverity, to: FaultSeverity) {
  return FAULT_SEVERITY_RANK[to] > FAULT_SEVERITY_RANK[from];
}

const isQuiet = (state: FaultState) =>
  state === "acknowledged" || state === "accepted";

function nextState(row: FaultRow, detection: Detection): FaultState {
  if (detection.state) return detection.state;
  if (!isQuiet(row.state)) return row.state;
  const worsened =
    isSeverityRise(row.severity, detection.severity) ||
    detection.reopen?.(row.data) === true;
  return worsened ? "open" : row.state;
}

// Level-based acknowledgement for kinds without a FaultAcceptance row
// (046 leaf-errors): the level lives on the fault while it stays quiet.
const LEVEL_ACKNOWLEDGED_KINDS = new Set<FaultKind>(["leaf-errors"]);

function acknowledgedLevel(data: FaultData) {
  const total = (data.total ?? {}) as FaultData;
  return {
    acknowledgedCounts: {
      read: total.read,
      write: total.write,
      checksum: total.checksum,
    },
  };
}

function withoutAcknowledgedLevel({
  acknowledgedCounts: _counts,
  ...data
}: FaultData): FaultData {
  return data;
}

function refreshedData(row: FaultRow, detection: Detection, state: FaultState) {
  const data = detection.carry?.(row.data) ?? detection.data;
  if (!isQuiet(state) || row.data.acknowledgedCounts === undefined) {
    return data;
  }
  return { ...data, acknowledgedCounts: row.data.acknowledgedCounts };
}

function openFault(detection: Detection, now: Date): FaultRow {
  const definition = FAULT_KIND_DEFINITIONS[detection.kind];
  const row = db
    .insert(fault)
    .values({
      kind: detection.kind,
      category: definition.category,
      subjectType: definition.subjectType,
      subjectId: detection.subjectId,
      key: detection.key,
      severity: detection.severity,
      data: detection.data,
      openedAt: now,
      lastSeenAt: now,
      state: detection.state ?? "open",
      stateChangedAt: now,
    })
    .returning()
    .get();
  if (!DIARY_SILENT_KINDS.has(row.kind)) {
    writeFaultEvent(row, "fault-opened", null, now, {
      severity: row.severity,
    });
  }
  return row;
}

function refreshFault(row: FaultRow, detection: Detection, now: Date) {
  const state = nextState(row, detection);
  const data = refreshedData(row, detection, state);
  const changed =
    state !== row.state ||
    detection.severity !== row.severity ||
    JSON.stringify(data) !== JSON.stringify(row.data);
  const updated = db
    .update(fault)
    .set({
      lastSeenAt: now,
      severity: detection.severity,
      data,
      ...(state === row.state
        ? {}
        : {
            state,
            stateChangedAt: now,
            note: state === "open" ? "" : row.note,
          }),
    })
    .where(eq(fault.id, row.id))
    .returning()
    .get();
  if (DIARY_SILENT_KINDS.has(row.kind)) return changed;
  if (state !== row.state) {
    writeFaultEvent(updated, "fault-state-changed", row.state, now);
  }
  if (isSeverityRise(row.severity, detection.severity)) {
    writeFaultEvent(updated, "fault-severity-raised", row.state, now, {
      severity: detection.severity,
      fromSeverity: row.severity,
    });
  }
  return changed;
}

function resolveFault(
  row: FaultRow,
  now: Date,
  note = row.note,
  extra: FaultData = {},
): FaultRow {
  const resolved = db
    .update(fault)
    .set({ state: "resolved", resolvedAt: now, stateChangedAt: now, note })
    .where(eq(fault.id, row.id))
    .returning()
    .get();
  if (!DIARY_SILENT_KINDS.has(row.kind)) {
    writeFaultEvent(resolved, "fault-resolved", row.state, now, extra);
  }
  return resolved;
}

function resolveSubjectFaults(
  subjectType: FaultSubjectType,
  subjectIds: number[],
  reason: string,
  now: Date,
) {
  if (subjectIds.length === 0) return 0;
  const rows = db
    .select()
    .from(fault)
    .where(
      and(
        eq(fault.subjectType, subjectType),
        inArray(fault.subjectId, subjectIds),
        isNull(fault.resolvedAt),
      ),
    )
    .all();
  for (const row of rows) resolveFault(row, now, row.note, { reason });
  return rows.length;
}

export function resolveReplicationFaults(
  replicationId: number,
  reason: string,
  now: Date,
) {
  return resolveSubjectFaults("replication", [replicationId], reason, now);
}

export function resolvePoolFaults(poolId: number, reason: string, now: Date) {
  const replicationIds = db
    .select({ id: replication.id })
    .from(replication)
    .innerJoin(dataset, eq(dataset.id, replication.targetDatasetId))
    .where(eq(dataset.poolId, poolId))
    .all()
    .map((row) => row.id);
  return (
    resolveSubjectFaults("pool", [poolId], reason, now) +
    resolveSubjectFaults("replication", replicationIds, reason, now)
  );
}

function withdrawalOf(row: FaultRow, withdrawn: Withdrawal[]) {
  return withdrawn.find(
    (withdrawal) =>
      withdrawal.subjectType === row.subjectType &&
      withdrawal.subjectId === row.subjectId,
  )?.reason;
}

function resolutionData(
  row: FaultRow,
  { superseded, withdrawn }: FaultScan,
): FaultData {
  const supersededBy = supersessionOf(row, superseded);
  if (supersededBy) return { supersededBy };
  const reason = withdrawalOf(row, withdrawn);
  return reason ? { reason } : {};
}

function supersessionOf(row: FaultRow, superseded: Supersession[]) {
  return superseded.find(
    (supersession) =>
      supersession.subjectType === row.subjectType &&
      supersession.subjectId === row.subjectId &&
      supersession.kinds.includes(row.kind) &&
      (supersession.key === undefined || supersession.key === row.key),
  )?.by;
}

function checkDeclaredSeverity({ kind, severity }: Detection) {
  if (FAULT_KIND_DEFINITIONS[kind].severities.includes(severity)) return;
  const message = `${kind} raised at ${severity}, which FAULT_KIND_DEFINITIONS does not declare`;
  if (process.env.VITEST) throw new Error(message);
  console.warn(message);
}

export function applyDetections(scan: FaultScan, now: Date): number {
  return db.transaction(() => {
    const live = new Map(
      liveRows().map((row) => [identity(row.kind, row.key), row]),
    );
    const seen = new Set<string>();
    let changes = 0;
    for (const detection of scan.detections) {
      checkDeclaredSeverity(detection);
      const id = identity(detection.kind, detection.key);
      if (seen.has(id)) continue;
      seen.add(id);
      const row = live.get(id);
      if (!row) {
        openFault(detection, now);
        changes += 1;
      } else if (refreshFault(row, detection, now)) {
        changes += 1;
      }
    }
    for (const [id, row] of live) {
      if (seen.has(id)) continue;
      resolveFault(row, now, row.note, resolutionData(row, scan));
      changes += 1;
    }
    return changes;
  });
}

export function notifyFaultsChanged() {
  useSseEvent().push("faults", { at: new Date().toISOString() });
}

export function faultDetectionContext(
  now: Date,
  disks: DiskSummary[],
): DetectionContext {
  return {
    now,
    disks,
    hosts: listHosts(),
    cadences: collectorCadences(),
  };
}

export async function syncFaults(
  now = new Date(),
  disks?: DiskSummary[],
): Promise<number> {
  const context = faultDetectionContext(now, disks ?? (await listDisks(now)));
  const changes = applyDetections(detectFaults(context), now);
  if (changes > 0) notifyFaultsChanged();
  return changes;
}

const SMART_ATTRIBUTE_STATE = {
  accept: "accepted",
  acknowledge: "acknowledged",
} as const;

export function setSmartAttributeFaultState(
  diskId: number,
  attrId: string,
  acceptance: { kind: keyof typeof SMART_ATTRIBUTE_STATE; note: string } | null,
  now: Date,
) {
  const row = db
    .select()
    .from(fault)
    .where(
      and(
        eq(fault.kind, "smart-attribute"),
        eq(fault.key, `${diskId}:${attrId}`),
        isNull(fault.resolvedAt),
      ),
    )
    .get();
  if (!row) return;
  const state = acceptance ? SMART_ATTRIBUTE_STATE[acceptance.kind] : "open";
  if (state === row.state) return;
  db.update(fault)
    .set({ state, stateChangedAt: now, note: acceptance?.note ?? "" })
    .where(eq(fault.id, row.id))
    .run();
  notifyFaultsChanged();
}

function getFaultRow(id: number): FaultRow {
  const row = db.select().from(fault).where(eq(fault.id, id)).get();
  if (!row) throw notFound(`Fault ${id} not found`);
  return row;
}

function assertAllowed(row: FaultRow, action: FaultAction) {
  if (row.state === "resolved") {
    throw new ServiceError(409, `Fault ${row.id} is resolved`);
  }
  if (!allowedActions(row).includes(action)) {
    throw new ServiceError(
      409,
      `Cannot ${action} a ${row.kind} fault that is ${row.state}`,
    );
  }
}

function smartAttributeOf(row: FaultRow) {
  return { diskId: row.subjectId, attrId: String(row.data.attrId) };
}

function levelData(row: FaultRow, state: FaultState): FaultData {
  if (!LEVEL_ACKNOWLEDGED_KINDS.has(row.kind)) return row.data;
  const data = withoutAcknowledgedLevel(row.data);
  return isQuiet(state) ? { ...data, ...acknowledgedLevel(row.data) } : data;
}

function setState(
  row: FaultRow,
  state: FaultState,
  note: string,
  now: Date,
): FaultRow {
  const updated = db
    .update(fault)
    .set({ state, note, stateChangedAt: now, data: levelData(row, state) })
    .where(eq(fault.id, row.id))
    .returning()
    .get();
  writeFaultEvent(updated, "fault-state-changed", row.state, now);
  return updated;
}

interface FaultActionOptions {
  note?: string;
  now?: Date;
}

export function performFaultAction(
  id: number,
  action: FaultAction,
  { note = "", now = new Date() }: FaultActionOptions = {},
): FaultRow {
  const result = db.transaction(() => {
    const row = getFaultRow(id);
    assertAllowed(row, action);
    if (action === "resolve") return resolveFault(row, now, note);
    if (row.kind === "smart-attribute") {
      const { diskId, attrId } = smartAttributeOf(row);
      if (action === "clear") clearAcceptance(diskId, attrId, now);
      else acceptFault({ diskId, attrId, kind: action, note, now });
      return getFaultRow(id);
    }
    if (action === "clear") return setState(row, "open", "", now);
    if (row.kind === "identity-conflict") return resolveFault(row, now, note);
    return setState(
      row,
      action === "accept" ? "accepted" : "acknowledged",
      note,
      now,
    );
  });
  notifyFaultsChanged();
  return result;
}

interface ReplicationSubject {
  targetName: string;
  sourceName: string | null;
  hostId: number;
}

interface SubjectLookup {
  disks: Map<number, typeof disk.$inferSelect>;
  pools: Map<number, PoolRow>;
  hostNames: Map<number, string>;
  poolPaths: Map<number, string>;
  replications: Map<number, ReplicationSubject>;
}

function replicationSubjects(): Map<number, ReplicationSubject> {
  const source = alias(dataset, "source");
  return new Map(
    db
      .select({
        id: replication.id,
        targetName: dataset.name,
        sourceName: source.name,
        hostId: pool.hostId,
      })
      .from(replication)
      .innerJoin(dataset, eq(dataset.id, replication.targetDatasetId))
      .innerJoin(pool, eq(pool.id, dataset.poolId))
      .leftJoin(source, eq(source.id, replication.sourceDatasetId))
      .all()
      .map(({ id, ...subject }) => [id, subject]),
  );
}

function subjectLookup(): SubjectLookup {
  return {
    disks: new Map(
      db
        .select()
        .from(disk)
        .all()
        .map((row) => [row.id, row]),
    ),
    pools: new Map(
      db
        .select()
        .from(pool)
        .all()
        .map((row) => [row.id, row]),
    ),
    hostNames: new Map(
      db
        .select({ id: host.id, name: host.name })
        .from(host)
        .all()
        .map((row) => [row.id, row.name]),
    ),
    poolPaths: poolPaths(),
    replications: replicationSubjects(),
  };
}

function describeSubject(row: FaultRow, lookup: SubjectLookup): FaultSubject {
  const base = { type: row.subjectType, id: row.subjectId };
  const hostName = (hostId: number | null | undefined) =>
    hostId == null ? null : (lookup.hostNames.get(hostId) ?? null);
  if (row.subjectType === "disk") {
    const found = lookup.disks.get(row.subjectId);
    return {
      ...base,
      label: found ? describeDisk(found) : "removed disk",
      hostName: hostName(found?.lastSeenHostId),
      path: found ? `/disks/${row.subjectId}` : null,
    };
  }
  if (row.subjectType === "pool") {
    const found = lookup.pools.get(row.subjectId);
    return {
      ...base,
      label: found?.name ?? "removed pool",
      hostName: hostName(found?.hostId),
      path: lookup.poolPaths.get(row.subjectId) ?? null,
    };
  }
  if (row.subjectType === "replication") {
    const found = lookup.replications.get(row.subjectId);
    return {
      ...base,
      label: found ? replicationLabel(found) : "removed replication",
      hostName: hostName(found?.hostId),
      path: found ? `/replications/${row.subjectId}` : null,
    };
  }
  const name = hostName(row.subjectId);
  return {
    ...base,
    label: name ?? "removed host",
    hostName: name,
    path: name === null ? null : hostPath(name),
  };
}

function present(row: FaultRow, lookup: SubjectLookup): FaultView {
  return {
    id: row.id,
    kind: row.kind,
    category: row.category,
    severity: row.severity,
    state: row.state,
    key: row.key,
    data: row.data,
    note: row.note,
    openedAt: row.openedAt.toISOString(),
    lastSeenAt: row.lastSeenAt.toISOString(),
    resolvedAt: iso(row.resolvedAt),
    stateChangedAt: row.stateChangedAt.toISOString(),
    subject: describeSubject(row, lookup),
  };
}

const STATE_ORDER = Object.fromEntries(
  FAULT_STATES.map((state, index) => [state, index]),
) as Record<FaultState, number>;

function byAttention(a: FaultView, b: FaultView) {
  return (
    STATE_ORDER[a.state] - STATE_ORDER[b.state] ||
    FAULT_SEVERITY_RANK[b.severity] - FAULT_SEVERITY_RANK[a.severity] ||
    (b.resolvedAt ?? b.openedAt).localeCompare(a.resolvedAt ?? a.openedAt) ||
    b.id - a.id
  );
}

export function listFaults(query: FaultsQuery): FaultsResponse {
  const lookup = subjectLookup();
  const conditions = [
    query.category && eq(fault.category, query.category),
    query.severity && eq(fault.severity, query.severity),
    query.subject &&
      and(
        eq(fault.subjectType, query.subject.type),
        eq(fault.subjectId, query.subject.id),
      ),
    query.namesDisk === undefined
      ? undefined
      : inArray(fault.kind, [...DISK_NAMING_FAULT_KINDS]),
  ].filter((condition) => condition !== undefined);
  const matching = db
    .select()
    .from(fault)
    .where(and(...conditions))
    .all()
    .filter(
      (row) =>
        query.namesDisk === undefined ||
        namedDiskIds(row.data).includes(query.namesDisk),
    )
    .map((row) => present(row, lookup))
    .filter((view) => !query.host || view.subject.hostName === query.host);
  const counts = Object.fromEntries(
    FAULT_STATES.map((state) => [state, 0]),
  ) as FaultCounts;
  for (const view of matching) counts[view.state] += 1;
  const states = new Set<FaultState>(query.state);
  return {
    faults: matching.filter((view) => states.has(view.state)).sort(byAttention),
    counts,
  };
}
