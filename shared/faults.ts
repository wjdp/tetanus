import { COLLECTOR_VERSION } from "#shared/collector";
import { formatDuration } from "#shared/hostFreshness";
import { HOST_TOOL_REQUIREMENTS, type HostTool } from "#shared/hostTools";

export const FAULT_STATES = [
  "open",
  "acknowledged",
  "accepted",
  "resolved",
] as const;
export type FaultState = (typeof FAULT_STATES)[number];

export const LIVE_FAULT_STATES = ["open", "acknowledged"] as const;

export const FAULT_CATEGORIES = ["disk", "zfs", "host"] as const;
export type FaultCategory = (typeof FAULT_CATEGORIES)[number];

export const FAULT_SEVERITIES = ["warning", "error"] as const;
export type FaultSeverity = (typeof FAULT_SEVERITIES)[number];

export const FAULT_SUBJECT_TYPES = [
  "disk",
  "pool",
  "host",
  "replication",
] as const;
export type FaultSubjectType = (typeof FAULT_SUBJECT_TYPES)[number];

export const FAULT_ACTIONS = [
  "acknowledge",
  "accept",
  "clear",
  "resolve",
] as const;
export type FaultAction = (typeof FAULT_ACTIONS)[number];

export const FAULT_KINDS = [
  "smart-attribute",
  "smart-health-failed",
  "disk-missing",
  "identity-conflict",
  "temperature-high",
  "pool-degraded",
  "pool-missing",
  "leaf-errors",
  "leaf-slow",
  "pool-data-errors",
  "scrub-overdue",
  "pool-status",
  "scrub-paused",
  "scan-stalled",
  "vdev-unredundant",
  "replication-late",
  "replication-stalled",
  "replication-target-gone",
  "collector-silent",
  "collector-incompatible",
  "collector-outdated",
  "host-degraded",
] as const;
export type FaultKind = (typeof FAULT_KINDS)[number];

export function isFaultKind(value: unknown): value is FaultKind {
  return FAULT_KINDS.includes(value as FaultKind);
}

export type FaultLifetime =
  | "transient"
  | "persistent"
  | "until-acknowledged"
  | "until-seen-again"
  | "until-resolved"
  | "until-no-data-errors";

export type FaultData = Record<string, unknown>;

interface FaultKindDefinition {
  category: FaultCategory;
  subjectType: FaultSubjectType;
  lifetime: FaultLifetime;
  actions: readonly FaultAction[];
  upgradeCommand?: true;
  title(data: FaultData, now: number): string;
}

const text = (value: unknown) =>
  value === undefined || value === null ? "" : String(value);

const plural = (count: number, noun: string) =>
  `${count} ${noun}${count === 1 ? "" : "s"}`;

function ageSince(value: unknown, now: number) {
  const at = typeof value === "string" ? Date.parse(value) : Number.NaN;
  return Number.isNaN(at) ? null : formatDuration(now - at);
}

function hostDegradedTitle(data: FaultData) {
  const requirement = HOST_TOOL_REQUIREMENTS[data.tool as HostTool];
  const subject = `${requirement?.label ?? text(data.tool)} ${text(data.version)}`;
  const older = `${subject} is older than ${text(data.minVersion)}`;
  return requirement ? `${older}: ${requirement.missing}` : older;
}

function smartAttributeTitle(data: FaultData) {
  const parts = [`${text(data.name)} ${text(data.value)}`];
  if (data.trend === "worsening") parts[0] += ", worsening";
  if (typeof data.acceptedValue === "number") {
    const label = data.acceptanceKind === "acknowledge" ? "ack" : "accepted";
    parts.push(`${label} at ${data.acceptedValue}`);
  }
  return parts.join(" · ");
}

export interface LeafCounts {
  read: number;
  write: number;
  checksum: number;
}

export interface PoolDegradedLeaf extends LeafCounts {
  vdevGuid: string;
  name: string;
  state: string;
  role: string;
  diskId: number | null;
  diskMissing: boolean;
}

export function leafLabel(name: unknown) {
  return text(name).split("/").at(-1) ?? "";
}

function poolDegradedLeafText(leaf: PoolDegradedLeaf) {
  const role = leaf.role === "normal" ? "" : `${leaf.role} `;
  const missing = leaf.diskMissing ? " (disk missing)" : "";
  return `${role}${leafLabel(leaf.name)} ${leaf.state}${missing}`;
}

function poolDegradedTitle(data: FaultData) {
  const state = text(data.state);
  const pool = `Pool ${text(data.poolName)}${state === "ONLINE" ? "" : ` ${state}`}`;
  const leaves = Array.isArray(data.leaves)
    ? (data.leaves as PoolDegradedLeaf[])
    : [];
  if (leaves.length === 0) return pool;
  return `${pool}: ${leaves.map(poolDegradedLeafText).join(", ")}`;
}

function leafErrorsTitle(data: FaultData) {
  const counts = `R ${text(data.read)} W ${text(data.write)} C ${text(data.checksum)}`;
  const rise = Number(data.rise24h);
  const recent = rise > 0 ? `, +${rise} in 24 h` : "";
  return `${leafLabel(data.name)} in ${text(data.poolName)}: ${counts}${recent}`;
}

function poolDataErrorsTitle(data: FaultData) {
  const parts: string[] = [];
  const dataErrors = Number(data.dataErrors);
  if (dataErrors > 0) parts.push(plural(dataErrors, "data error"));
  const scanErrors = Number(data.scanErrors);
  if (scanErrors > 0) {
    parts.push(
      `${text(data.function).toLowerCase() || "scan"} found ${plural(scanErrors, "error")}`,
    );
  }
  return `Pool ${text(data.poolName)}: ${parts.join("; ")}`;
}

function firstLine(value: unknown) {
  return text(value).trim().split("\n")[0]?.trim() ?? "";
}

function poolStatusTitle(data: FaultData) {
  const summary = text(data.title) || firstLine(data.status);
  const message = summary ? `${text(data.msgid)} ${summary}` : text(data.msgid);
  return `Pool ${text(data.poolName)}: ${message}`;
}

function scanStalledTitle(data: FaultData, now: number) {
  const scan = text(data.function).toLowerCase() || "scan";
  const age = ageSince(data.progressAt, now);
  const stalled = `Pool ${text(data.poolName)} ${scan} stalled`;
  return age ? `${stalled} for ${age}` : stalled;
}

function temperatureHighTitle(data: FaultData, now: number) {
  if (data.celsius === undefined) return "Running hot";
  const reading = `${text(data.celsius)} °C (limit ${text(data.threshold)} °C)`;
  const age = ageSince(data.hotSince, now);
  return age ? `${reading}, hot for ${age}` : reading;
}

function replicationTitle(state: string) {
  return (data: FaultData, now: number) => {
    const age = ageSince(data.lastSyncAt, now);
    const target = `Replication into ${text(data.targetName)} ${state}`;
    return age ? `${target}, last synced ${age} ago` : target;
  };
}

export const FAULT_KIND_DEFINITIONS: Record<FaultKind, FaultKindDefinition> = {
  "smart-attribute": {
    category: "disk",
    subjectType: "disk",
    lifetime: "persistent",
    actions: ["acknowledge", "accept", "clear"],
    title: smartAttributeTitle,
  },
  "smart-health-failed": {
    category: "disk",
    subjectType: "disk",
    lifetime: "persistent",
    actions: ["acknowledge", "clear"],
    title: () => "SMART health check failed",
  },
  "disk-missing": {
    category: "disk",
    subjectType: "disk",
    lifetime: "transient",
    actions: ["acknowledge", "clear"],
    title: (data, now) => {
      const age = ageSince(data.lastSeenAt, now);
      return age ? `Missing, last seen ${age} ago` : "Missing";
    },
  },
  "identity-conflict": {
    category: "disk",
    subjectType: "disk",
    lifetime: "until-acknowledged",
    actions: ["acknowledge"],
    title: (data) => {
      const others = typeof data.others === "string" ? data.others : "";
      return `Identity conflict with ${others || "another disk"}`;
    },
  },
  "temperature-high": {
    category: "disk",
    subjectType: "disk",
    lifetime: "transient",
    actions: ["acknowledge", "accept", "clear"],
    title: temperatureHighTitle,
  },
  "pool-degraded": {
    category: "zfs",
    subjectType: "pool",
    lifetime: "transient",
    actions: ["acknowledge", "accept", "clear"],
    title: poolDegradedTitle,
  },
  "pool-missing": {
    category: "zfs",
    subjectType: "pool",
    lifetime: "until-seen-again",
    actions: ["acknowledge", "accept", "clear"],
    title: (data, now) => {
      const age = ageSince(data.lastSeenAt, now);
      const missing = `Pool ${text(data.poolName)} missing`;
      return age ? `${missing}, last seen ${age} ago` : missing;
    },
  },
  "leaf-errors": {
    category: "zfs",
    subjectType: "pool",
    lifetime: "until-resolved",
    actions: ["acknowledge", "accept", "clear", "resolve"],
    title: leafErrorsTitle,
  },
  "leaf-slow": {
    category: "zfs",
    subjectType: "pool",
    lifetime: "transient",
    actions: ["acknowledge", "accept", "clear"],
    title: (data) =>
      `${leafLabel(data.name)} in ${text(data.poolName)}: ${plural(Number(data.rise24h), "slow I/O")} in 24 h`,
  },
  "pool-data-errors": {
    category: "zfs",
    subjectType: "pool",
    lifetime: "until-no-data-errors",
    actions: ["acknowledge", "clear"],
    title: poolDataErrorsTitle,
  },
  "scrub-overdue": {
    category: "zfs",
    subjectType: "pool",
    lifetime: "transient",
    actions: ["acknowledge", "accept", "clear"],
    title: (data, now) => {
      const age = ageSince(data.lastScrubAt, now);
      const pool = `Pool ${text(data.poolName)}`;
      return age
        ? `${pool} last scrubbed ${age} ago`
        : `${pool} never scrubbed`;
    },
  },
  "pool-status": {
    category: "zfs",
    subjectType: "pool",
    lifetime: "transient",
    actions: ["acknowledge", "accept", "clear"],
    title: poolStatusTitle,
  },
  "scrub-paused": {
    category: "zfs",
    subjectType: "pool",
    lifetime: "transient",
    actions: ["acknowledge", "accept", "clear"],
    title: (data, now) => {
      const age = ageSince(data.pausedAt, now);
      const paused = `Pool ${text(data.poolName)} scrub paused`;
      return age ? `${paused} for ${age}` : paused;
    },
  },
  "scan-stalled": {
    category: "zfs",
    subjectType: "pool",
    lifetime: "transient",
    actions: ["acknowledge", "clear"],
    title: scanStalledTitle,
  },
  "vdev-unredundant": {
    category: "zfs",
    subjectType: "pool",
    lifetime: "transient",
    actions: ["acknowledge", "accept", "clear"],
    title: (data) =>
      `${text(data.role)} ${leafLabel(data.name)} in ${text(data.poolName)} is a single device`,
  },
  "replication-late": {
    category: "zfs",
    subjectType: "replication",
    lifetime: "transient",
    actions: ["acknowledge", "accept", "clear"],
    title: replicationTitle("late"),
  },
  "replication-stalled": {
    category: "zfs",
    subjectType: "replication",
    lifetime: "transient",
    actions: ["acknowledge", "accept", "clear"],
    title: replicationTitle("stalled"),
  },
  "replication-target-gone": {
    category: "zfs",
    subjectType: "replication",
    lifetime: "transient",
    actions: ["acknowledge", "accept", "clear"],
    title: (data) =>
      `Replication target ${text(data.targetName)} no longer exists`,
  },
  "collector-silent": {
    category: "host",
    subjectType: "host",
    lifetime: "transient",
    actions: ["acknowledge", "clear"],
    title: (data, now) => {
      const age = ageSince(data.lastOkAt, now);
      return age ? `No data for ${age}` : "No data yet";
    },
  },
  "collector-incompatible": {
    category: "host",
    subjectType: "host",
    lifetime: "transient",
    actions: ["acknowledge", "clear"],
    upgradeCommand: true,
    title: (data) =>
      `Collector ${text(data.version)} is too old; ${text(data.minVersion)} or later is needed`,
  },
  "collector-outdated": {
    category: "host",
    subjectType: "host",
    lifetime: "transient",
    actions: ["acknowledge", "clear"],
    upgradeCommand: true,
    title: (data) =>
      `Collector ${text(data.version)} is behind ${text(data.currentVersion) || COLLECTOR_VERSION}`,
  },
  "host-degraded": {
    category: "host",
    subjectType: "host",
    lifetime: "transient",
    actions: ["accept", "clear"],
    title: hostDegradedTitle,
  },
};

export function faultTitle(
  fault: { kind: FaultKind; data: FaultData },
  now = Date.now(),
): string {
  return FAULT_KIND_DEFINITIONS[fault.kind].title(fault.data, now);
}

export function allowedActions(fault: {
  kind: FaultKind;
  state: FaultState;
}): FaultAction[] {
  if (fault.state === "resolved") return [];
  const actions = FAULT_KIND_DEFINITIONS[fault.kind].actions;
  return actions.filter((action) => {
    if (action === "clear") return fault.state !== "open";
    if (action === "acknowledge") return fault.state === "open";
    if (action === "resolve") return true;
    return fault.state !== "accepted";
  });
}

export const FAULT_SEVERITY_RANK: Record<FaultSeverity, number> = {
  warning: 1,
  error: 2,
};

export interface SeverityThresholds {
  warning: number;
  error: number;
}

/** Severity of a value against warning/error levels; a live fault steps down only once the value is `margin` below the level it crossed. */
export function thresholdSeverity(
  current: FaultSeverity | null,
  value: number,
  { warning, error }: SeverityThresholds,
  margin: number,
): FaultSeverity | null {
  if (value >= error) return "error";
  if (current === "error" && value >= error - margin) return "error";
  if (value >= warning) return "warning";
  if (current !== null && value >= warning - margin) return "warning";
  return null;
}

export interface FaultSubject {
  type: FaultSubjectType;
  id: number;
  label: string;
  hostName: string | null;
}

export interface FaultView {
  id: number;
  kind: FaultKind;
  category: FaultCategory;
  severity: FaultSeverity;
  state: FaultState;
  key: string;
  data: FaultData;
  note: string;
  openedAt: string;
  lastSeenAt: string;
  resolvedAt: string | null;
  stateChangedAt: string;
  subject: FaultSubject;
}

export type FaultCounts = Record<FaultState, number>;

export interface FaultsResponse {
  faults: FaultView[];
  counts: FaultCounts;
}

export interface DiskFaultCounts {
  error: number;
  warning: number;
  acknowledged: number;
}

export const NO_DISK_FAULTS: DiskFaultCounts = {
  error: 0,
  warning: 0,
  acknowledged: 0,
};
