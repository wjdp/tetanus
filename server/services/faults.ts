import { and, count, desc, eq, isNull } from "drizzle-orm";
import { COLLECTOR_VERSION, MIN_COLLECTOR_VERSION } from "#shared/collector";
import {
  allowedActions,
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
} from "#shared/faults";
import {
  allGroupFreshness,
  type CadenceOverrides,
  DEMO_CADENCES,
  isEveryGroupSilent,
  isHostOffline,
} from "#shared/hostFreshness";
import type { FaultsQuery } from "#shared/schemas/faults";
import { healthStatus, overlayStatus } from "#shared/smart/status";
import { db } from "~~/server/database/client";
import { diaryEntry, disk, fault, host, pool } from "~~/server/database/schema";
import {
  acceptFault,
  activeAcceptances,
  clearAcceptance,
} from "~~/server/services/acceptance";
import { diskLabel } from "~~/server/services/alerts/rules";
import { addAutoEvent } from "~~/server/services/diary";
import { type DiskSummary, listDisks } from "~~/server/services/disks";
import { type HostWithRuns, listHosts } from "~~/server/services/hosts";
import { detectPoolFaults } from "~~/server/services/poolFaults";
import {
  attributesOfReading,
  attributeTrend,
  latestReading,
} from "~~/server/services/smart";
import { useSseEvent } from "~~/server/sse";
import { isDemo } from "~~/server/utils/demo";
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

export interface FaultScan {
  detections: Detection[];
  superseded: Supersession[];
}

export interface DetectionContext {
  now: Date;
  disks: DiskSummary[];
  hosts: HostWithRuns[];
  cadences: CadenceOverrides;
}

export const LEFT_SERVICE_STATES = new Set(["dead", "retired", "sold"]);

const ACCEPTANCE_STATE = {
  accepted: "accepted",
  acknowledged: "acknowledged",
} as const;

const iso = (date: Date | null) => date?.toISOString() ?? null;

function inService(disks: DiskSummary[]) {
  return disks.filter((row) => !LEFT_SERVICE_STATES.has(row.state));
}

function detectSmartAttributes({ disks }: DetectionContext): Detection[] {
  return inService(disks).flatMap((row) => {
    const reading = latestReading(row.id);
    if (!reading) return [];
    const active = activeAcceptances(row.id);
    return attributesOfReading(reading.id)
      .filter((attribute) => attribute.status !== "passed")
      .map((attribute): Detection => {
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
            trend: attributeTrend(row.id, attribute),
            ...(acceptance && covered
              ? {
                  acceptanceKind: acceptance.kind,
                  acceptedValue: acceptance.acceptedValue,
                }
              : {}),
          },
        };
      });
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
    .filter((row) => row.state === "missing" && !suppressedDiskIds.has(row.id))
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

function detectIdentityConflicts(): Detection[] {
  const entries = db
    .select()
    .from(diaryEntry)
    .where(eq(diaryEntry.eventType, "identity-conflict"))
    .orderBy(desc(diaryEntry.at), desc(diaryEntry.id))
    .all();
  const byKey = new Map<string, Detection>();
  for (const entry of entries) {
    if (entry.subjectId === null) continue;
    const key = identityConflictKey(entry.subjectId, entry.data.diskIds);
    if (byKey.has(key)) continue;
    if (wasAcknowledgedSince("identity-conflict", key, entry.at)) continue;
    byKey.set(key, {
      kind: "identity-conflict",
      key,
      subjectId: entry.subjectId,
      severity: "error",
      data: { diskIds: entry.data.diskIds, conflictAt: iso(entry.at) },
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
    const at = now.getTime();
    if (isHostOffline(row, at, cadences)) return [];
    if (!isEveryGroupSilent(allGroupFreshness(row.lastRuns, at, cadences))) {
      return [];
    }
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

export function detectFaults(context: DetectionContext): FaultScan {
  const silent = detectCollectorSilent(context);
  const pools = detectPoolFaults(
    context,
    new Set(silent.map((detection) => detection.subjectId)),
  );
  const suppressedDiskIds = new Set(
    pools.superseded
      .filter((supersession) => supersession.subjectType === "disk")
      .map((supersession) => supersession.subjectId),
  );
  return {
    detections: [
      ...detectSmartAttributes(context),
      ...detectHealthFailed(context),
      ...detectMissing(context, suppressedDiskIds),
      ...detectIdentityConflicts(),
      ...pools.detections,
      ...silent,
      ...detectCollectorVersion(context),
    ],
    superseded: pools.superseded,
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
  eventType: "fault-opened" | "fault-resolved" | "fault-state-changed",
  from: FaultState | null,
  at: Date,
  extra: FaultData = {},
) {
  const title = faultTitle(row, at.getTime());
  const prefix = {
    "fault-opened": "fault",
    "fault-resolved": "fault resolved",
    "fault-state-changed": `fault ${row.state}`,
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
  if (!isQuiet(state) || row.data.acknowledgedCounts === undefined) {
    return detection.data;
  }
  return { ...detection.data, acknowledgedCounts: row.data.acknowledgedCounts };
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
  if (state !== row.state && !DIARY_SILENT_KINDS.has(row.kind)) {
    writeFaultEvent(updated, "fault-state-changed", row.state, now);
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

export function resolvePoolFaults(poolId: number, reason: string, now: Date) {
  const rows = db
    .select()
    .from(fault)
    .where(
      and(
        eq(fault.subjectType, "pool"),
        eq(fault.subjectId, poolId),
        isNull(fault.resolvedAt),
      ),
    )
    .all();
  for (const row of rows) resolveFault(row, now, row.note, { reason });
  return rows.length;
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

export function applyDetections(
  { detections, superseded }: FaultScan,
  now: Date,
): number {
  return db.transaction(() => {
    const live = new Map(
      liveRows().map((row) => [identity(row.kind, row.key), row]),
    );
    const seen = new Set<string>();
    let changes = 0;
    for (const detection of detections) {
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
      const supersededBy = supersessionOf(row, superseded);
      resolveFault(row, now, row.note, supersededBy ? { supersededBy } : {});
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
    cadences: isDemo() ? DEMO_CADENCES : {},
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

interface SubjectLookup {
  disks: Map<number, typeof disk.$inferSelect>;
  pools: Map<number, PoolRow>;
  hostNames: Map<number, string>;
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
      label: diskLabel(row.subjectId, found),
      hostName: hostName(found?.lastSeenHostId),
    };
  }
  if (row.subjectType === "pool") {
    const found = lookup.pools.get(row.subjectId);
    return {
      ...base,
      label: found?.name ?? `pool ${row.subjectId}`,
      hostName: hostName(found?.hostId),
    };
  }
  const name = hostName(row.subjectId);
  return { ...base, label: name ?? `host ${row.subjectId}`, hostName: name };
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

export function faultBadge(): number {
  return (
    db
      .select({ open: count() })
      .from(fault)
      .where(and(eq(fault.state, "open"), eq(fault.severity, "error")))
      .get()?.open ?? 0
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
  ].filter((condition) => condition !== undefined);
  const matching = db
    .select()
    .from(fault)
    .where(and(...conditions))
    .all()
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
    badge: faultBadge(),
  };
}
