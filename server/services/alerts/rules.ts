import {
  ALERT_RULES,
  type AlertRule,
  type AlertSeverity,
} from "#shared/alerts";
import type { DiarySubjectType } from "#shared/diary";
import type { DiaryEntryRow } from "~~/server/services/diary";

export interface AlertDisk {
  alias: string | null;
  model: string | null;
  serial: string | null;
  hostName: string | null;
}

export interface AlertPool {
  name: string;
  hostName: string | null;
}

export interface AlertHost {
  name: string;
}

export interface AlertContext {
  disk(id: number): AlertDisk | undefined;
  pool(id: number): AlertPool | undefined;
  host(id: number): AlertHost | undefined;
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
    case "resilver-finished": {
      const errors = Number(data.errors);
      if (!(errors > 0)) return null;
      return {
        rule: "scan-errors",
        value: String(errors),
        detail: `${text(data.function).toLowerCase()} finished with ${plural(errors, "error")}`,
      };
    }
    default:
      return null;
  }
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

export function diskLabel(id: number, found: AlertDisk | undefined) {
  if (found?.alias) return found.alias;
  const described = [found?.model, found?.serial].filter(Boolean).join(" ");
  return described || `disk ${id}`;
}

function describeSubject(
  entry: DiaryEntryRow,
  subjectId: number,
  context: AlertContext,
) {
  if (entry.subjectType === "host") {
    const hostName = context.host(subjectId)?.name ?? `host ${subjectId}`;
    return { host: hostName, subject: withHost(hostName, "collector") };
  }
  if (entry.subjectType === "pool") {
    const found = context.pool(subjectId);
    const hostName = found?.hostName ?? null;
    return {
      host: hostName,
      subject: withHost(hostName, found?.name ?? `pool ${subjectId}`),
    };
  }
  const found = context.disk(subjectId);
  const hostName = found?.hostName ?? null;
  return {
    host: hostName,
    subject: withHost(hostName, diskLabel(subjectId, found)),
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
  return null;
}

export function deriveAlert(
  entry: DiaryEntryRow,
  context: AlertContext,
): Alert | null {
  if (entry.kind !== "auto" || entry.subjectId === null) return null;
  const match = matchEntry(entry, entry.subjectId, context);
  if (!match) return null;
  const { label: title, severity } = ALERT_RULES[match.rule];
  const { host, subject } = describeSubject(entry, entry.subjectId, context);
  return {
    rule: match.rule,
    severity,
    subjectType: entry.subjectType,
    subjectId: entry.subjectId,
    host,
    subject,
    title,
    message: `${subject}: ${match.detail}`,
    at: entry.at,
    dedupeKey: [
      match.rule,
      entry.subjectType,
      entry.subjectId,
      match.value,
      entry.id,
    ].join(":"),
    diaryEntryId: entry.id,
  };
}

export function deriveAlerts(
  entries: DiaryEntryRow[],
  context: AlertContext,
): Alert[] {
  return entries.flatMap((entry) => deriveAlert(entry, context) ?? []);
}
