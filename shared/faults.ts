import { COLLECTOR_VERSION } from "#shared/collector";
import { formatDuration } from "#shared/hostFreshness";

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

export const FAULT_SUBJECT_TYPES = ["disk", "pool", "host"] as const;
export type FaultSubjectType = (typeof FAULT_SUBJECT_TYPES)[number];

export const FAULT_ACTIONS = ["acknowledge", "accept", "clear"] as const;
export type FaultAction = (typeof FAULT_ACTIONS)[number];

export const FAULT_KINDS = [
  "smart-attribute",
  "smart-health-failed",
  "disk-missing",
  "identity-conflict",
  "pool-degraded",
  "scan-errors",
  "collector-silent",
  "collector-incompatible",
  "collector-outdated",
] as const;
export type FaultKind = (typeof FAULT_KINDS)[number];

export type FaultLifetime =
  | "transient"
  | "persistent"
  | "until-acknowledged"
  | "until-clean-scan";

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

function smartAttributeTitle(data: FaultData) {
  const parts = [`${text(data.name)} ${text(data.value)}`];
  if (data.trend === "worsening") parts[0] += ", worsening";
  if (typeof data.acceptedValue === "number") {
    const label = data.acceptanceKind === "acknowledge" ? "ack" : "accepted";
    parts.push(`${label} at ${data.acceptedValue}`);
  }
  return parts.join(" · ");
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
      const others = Array.isArray(data.diskIds) ? data.diskIds.slice(1) : [];
      return `Identity conflict with disk ${others.join(", ")}`;
    },
  },
  "pool-degraded": {
    category: "zfs",
    subjectType: "pool",
    lifetime: "transient",
    actions: ["acknowledge", "accept", "clear"],
    title: (data) => `Pool ${text(data.poolName)} ${text(data.state)}`,
  },
  "scan-errors": {
    category: "zfs",
    subjectType: "pool",
    lifetime: "until-clean-scan",
    actions: ["acknowledge", "clear"],
    title: (data) =>
      `Pool ${text(data.poolName)} ${text(data.function).toLowerCase()} found ${plural(Number(data.errors), "error")}`,
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
    return fault.state !== "accepted";
  });
}

export const FAULT_SEVERITY_RANK: Record<FaultSeverity, number> = {
  warning: 1,
  error: 2,
};

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
  badge: number;
}
