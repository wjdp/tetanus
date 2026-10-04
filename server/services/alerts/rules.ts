import {
  ALERT_RULES,
  type AlertRule,
  type AlertSeverity,
} from "#shared/alerts";
import type { DiarySubjectType } from "#shared/diary";
import { type Disposal, describeDisk, isDisposed } from "#shared/disk";
import type { DiaryEntryRow } from "~~/server/services/diary";

export interface AlertDisk {
  alias: string | null;
  model: string | null;
  serial: string | null;
  hostName: string | null;
  disposal: Disposal | null;
}

export interface AlertPool {
  name: string;
  hostName: string | null;
  archived: boolean;
}

export interface AlertHost {
  name: string;
}

export interface AlertReplication {
  label: string;
  hostName: string | null;
  archived: boolean;
}

export interface AlertContext {
  disk(id: number): AlertDisk | undefined;
  pool(id: number): AlertPool | undefined;
  host(id: number): AlertHost | undefined;
  replication(id: number): AlertReplication | undefined;
  hasActiveAcceptance(diskId: number, attrId: string): boolean;
}

export interface Alert {
  rule: AlertRule;
  severity: AlertSeverity;
  subjectType: DiarySubjectType;
  subjectId: number;
  host: string | null;
  subject: string;
  title: string;
  message: string;
  at: Date;
  dedupeKey: string;
  diaryEntryId: number;
}

interface Match {
  rule: AlertRule;
  value: string;
  detail: string;
  subject?: { type: DiarySubjectType; id: number };
}

type Data = Record<string, unknown>;

function text(value: unknown) {
  return value === undefined || value === null ? "" : String(value);
}

function plural(count: number, noun: string) {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

const RECOVERED_DISK_STATES = new Set(["in-use", "spare"]);

function matchDiskEntry(
  entry: DiaryEntryRow,
  diskId: number,
  data: Data,
  context: AlertContext,
): Match | null {
  const { from, to } = data;
  switch (entry.eventType) {
    case "attribute-status-changed": {
      const attrId = text(data.attrId);
      if (
        to !== "failed" ||
        data.superseded === true ||
        context.hasActiveAcceptance(diskId, attrId)
      ) {
        return null;
      }
      return {
        rule: "attribute-failed",
        value: attrId,
        detail: `${text(data.name) || attrId} failed (${text(data.value)})`,
      };
    }
    case "acceptance-superseded":
    case "acknowledgement-superseded":
      return {
        rule: entry.eventType,
        value: `${text(data.attrId)}@${text(data.value)}`,
        detail: entry.title,
      };
    case "smart-status-changed":
      if (data.cause === "acceptance") return null;
      if (to === "failed") {
        if (Array.isArray(data.superseded) && data.superseded.length > 0) {
          return null;
        }
        return {
          rule: "disk-failed",
          value: "failed",
          detail: `SMART failed (was ${text(from)})`,
        };
      }
      if (from === "failed") {
        return {
          rule: "disk-recovered",
          value: text(to),
          detail: `SMART ${text(to)} (was failed)`,
        };
      }
      return null;
    case "state-changed":
      if (to === "missing") {
        return {
          rule: "disk-missing",
          value: "missing",
          detail: `missing (was ${text(from)})`,
        };
      }
      if (from === "missing" && RECOVERED_DISK_STATES.has(text(to))) {
        return {
          rule: "disk-reappeared",
          value: text(to),
          detail: `${text(to)} (was missing)`,
        };
      }
      return null;
    case "disposed-disk-seen": {
      const hostId = Number(data.hostId);
      const hostName = context.host(hostId)?.name ?? "removed host";
      const kind = context.disk(diskId)?.disposal?.kind;
      const disposed = kind ? `disposed (${kind})` : "disposed";
      return {
        rule: "disposed-disk-seen",
        value: text(data.disposalOn),
        detail: `seen on ${hostName}, ${disposed} ${text(data.disposalOn)}`,
      };
    }
    case "identity-conflict": {
      const diskIds = Array.isArray(data.diskIds) ? data.diskIds : [];
      return {
        rule: "identity-conflict",
        value: diskIds.join(","),
        detail: entry.title,
      };
    }
    default:
      return null;
  }
}

// Kinds whose condition has no diary event of its own: they alert when the
// fault opens.
const FAULT_OPENED_RULES = new Set<AlertRule>([
  "pool-missing",
  "scrub-overdue",
  "leaf-slow",
  "pool-status",
  "scrub-paused",
  "scan-stalled",
  "vdev-unredundant",
]);

function isFaultOpenedRule(kind: unknown): kind is AlertRule {
  return FAULT_OPENED_RULES.has(kind as AlertRule);
}

function counts(value: unknown) {
  const { read, write, checksum } = (value ?? {}) as Data;
  return `${text(read)}/${text(write)}/${text(checksum)}`;
}

function matchPoolEntry(entry: DiaryEntryRow, data: Data): Match | null {
  const { from, to } = data;
  switch (entry.eventType) {
    case "pool-state-changed":
      return {
        rule: to === "ONLINE" ? "pool-recovered" : "pool-degraded",
        value: text(to),
        detail: `${text(to)} (was ${text(from)})`,
      };
    case "scrub-finished":
    case "resilver-finished":
    case "scan-finished": {
      const errors = Number(data.errors);
      if (!(errors > 0)) return null;
      return {
        rule: "pool-data-errors",
        value: `scan:${errors}`,
        detail: `${text(data.function).toLowerCase()} finished with ${plural(errors, "error")}`,
      };
    }
    case "pool-data-errors-changed":
      return {
        rule: "pool-data-errors",
        value: `data:${text(to)}`,
        detail: `${plural(Number(to), "data error")} (was ${text(from)})`,
      };
    case "leaf-errors-changed":
      return {
        rule: "leaf-errors",
        value: `${text(data.vdevGuid)}:${counts(to)}`,
        detail: entry.title,
      };
    case "fault-opened":
      if (!isFaultOpenedRule(data.kind)) return null;
      return {
        rule: data.kind,
        value: text(data.key),
        detail: entry.title.replace(/^fault: /, ""),
      };
    default:
      return null;
  }
}

const REPLICATION_FAULT_RULES = new Set<AlertRule>([
  "replication-late",
  "replication-stalled",
  "replication-target-gone",
]);

function matchReplicationEntry(entry: DiaryEntryRow, data: Data): Match | null {
  if (entry.eventType !== "fault-opened") return null;
  if (!REPLICATION_FAULT_RULES.has(data.kind as AlertRule)) return null;
  return {
    rule: data.kind as AlertRule,
    value: text(data.key),
    detail: entry.title.replace(/^fault: /, ""),
  };
}

const HEALTHY_VDEV_STATES = new Set(["ONLINE", "AVAIL"]);

// A pool that goes non-ONLINE alerts through pool-state-changed; a failed
// log, cache or spare leaves the pool ONLINE and alerts here, on the pool.
function matchVdevEntry(entry: DiaryEntryRow, data: Data): Match | null {
  if (entry.eventType !== "vdev-state-changed") return null;
  const poolId = Number(data.poolId);
  if (!Number.isInteger(poolId) || data.poolState !== "ONLINE") return null;
  if (HEALTHY_VDEV_STATES.has(text(data.to))) return null;
  return {
    rule: "pool-degraded",
    value: `${entry.subjectId}:${text(data.to)}`,
    detail: entry.title,
    subject: { type: "pool", id: poolId },
  };
}

function matchHostEntry(entry: DiaryEntryRow, data: Data): Match | null {
  if (entry.eventType !== "collector-status-changed") return null;
  const { from, to, version, minVersion } = data;
  if (to === "incompatible") {
    return {
      rule: "collector-incompatible",
      value: text(version),
      detail: `${text(version)} is too old; tetanus needs ${text(minVersion)} or later`,
    };
  }
  if (from === "incompatible") {
    return {
      rule: "collector-compatible",
      value: text(version),
      detail: `${text(version)} (was incompatible)`,
    };
  }
  return null;
}

function withHost(hostName: string | null, label: string) {
  return hostName ? `${hostName} · ${label}` : label;
}

function diskLabel(
  found: Pick<AlertDisk, "alias" | "model" | "serial"> | undefined,
) {
  return found ? describeDisk(found) : "removed disk";
}

function describeSubject(
  subjectType: DiarySubjectType,
  subjectId: number,
  context: AlertContext,
) {
  if (subjectType === "host") {
    const hostName = context.host(subjectId)?.name ?? "removed host";
    return { host: hostName, subject: withHost(hostName, "collector") };
  }
  if (subjectType === "pool") {
    const found = context.pool(subjectId);
    const hostName = found?.hostName ?? null;
    return {
      host: hostName,
      subject: withHost(hostName, found?.name ?? "removed pool"),
    };
  }
  if (subjectType === "replication") {
    const found = context.replication(subjectId);
    const hostName = found?.hostName ?? null;
    return {
      host: hostName,
      subject: withHost(hostName, found?.label ?? `replication ${subjectId}`),
    };
  }
  const found = context.disk(subjectId);
  const hostName = found?.hostName ?? null;
  return {
    host: hostName,
    subject: withHost(hostName, diskLabel(found)),
  };
}

function matchEntry(
  entry: DiaryEntryRow,
  subjectId: number,
  context: AlertContext,
): Match | null {
  if (entry.subjectType === "disk") {
    return matchDiskEntry(entry, subjectId, entry.data, context);
  }
  if (entry.subjectType === "pool") return matchPoolEntry(entry, entry.data);
  if (entry.subjectType === "host") return matchHostEntry(entry, entry.data);
  if (entry.subjectType === "vdev") return matchVdevEntry(entry, entry.data);
  if (entry.subjectType === "replication") {
    return matchReplicationEntry(entry, entry.data);
  }
  return null;
}

function isSuppressedForDisposal(
  rule: AlertRule,
  subjectType: DiarySubjectType,
  subjectId: number,
  context: AlertContext,
) {
  if (subjectType !== "disk" || rule === "disposed-disk-seen") return false;
  const found = context.disk(subjectId);
  return found !== undefined && isDisposed(found);
}

export function deriveAlert(
  entry: DiaryEntryRow,
  context: AlertContext,
): Alert | null {
  if (entry.kind !== "auto" || entry.subjectId === null) return null;
  const match = matchEntry(entry, entry.subjectId, context);
  if (!match) return null;
  const { label: title, severity } = ALERT_RULES[match.rule];
  const subjectType = match.subject?.type ?? entry.subjectType;
  const subjectId = match.subject?.id ?? entry.subjectId;
  if (subjectType === "pool" && context.pool(subjectId)?.archived) return null;
  if (
    subjectType === "replication" &&
    context.replication(subjectId)?.archived
  ) {
    return null;
  }
  if (isSuppressedForDisposal(match.rule, subjectType, subjectId, context)) {
    return null;
  }
  const { host, subject } = describeSubject(subjectType, subjectId, context);
  return {
    rule: match.rule,
    severity,
    subjectType,
    subjectId,
    host,
    subject,
    title,
    message: `${subject}: ${match.detail}`,
    at: entry.at,
    dedupeKey: [match.rule, subjectType, subjectId, match.value, entry.id].join(
      ":",
    ),
    diaryEntryId: entry.id,
  };
}

export function deriveAlerts(
  entries: DiaryEntryRow[],
  context: AlertContext,
): Alert[] {
  return entries.flatMap((entry) => deriveAlert(entry, context) ?? []);
}
