import { COLLECTOR_VERSION, MIN_COLLECTOR_VERSION } from "#shared/collector";
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
  "smart-counters-reset",
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
  "pool-capacity",
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
  label: string;
  category: FaultCategory;
  subjectType: FaultSubjectType;
  severities: readonly FaultSeverity[];
  trigger: string;
  resolves: string;
  settings?: readonly string[];
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

function poolCapacityTitle(data: FaultData) {
  if (data.cap === undefined) return "Pool nearly full";
  const subject =
    data.vdevGuid === undefined
      ? `Pool ${text(data.poolName)}`
      : `${text(data.role)} ${leafLabel(data.name)} in ${text(data.poolName)}`;
  const frag = typeof data.frag === "number" ? ` · frag ${data.frag} %` : "";
  return `${subject} ${text(data.cap)} % full${frag}`;
}

function temperatureHighTitle(data: FaultData, now: number) {
  if (data.celsius === undefined) return "Running hot";
  const reading = `${text(data.celsius)} °C (limit ${text(data.threshold)} °C)`;
  const age = ageSince(data.hotSince, now);
  return age ? `${reading}, hot for ${age}` : reading;
}

const hours = (value: unknown) =>
  typeof value === "number" ? `${value.toLocaleString("en-GB")} h` : "?";

const FARM_IDENTITY_LABELS: Record<string, string> = {
  serial: "serial",
  wwn: "WWN",
};

function smartCountersResetTitle(data: FaultData) {
  const parts: string[] = [];
  if (typeof data.resetHours === "number") {
    parts.push(
      `SMART power-on hours reset: FARM ${hours(data.farmHours)}, SMART ${hours(data.smartHours)}`,
    );
  }
  const mismatches = Array.isArray(data.mismatches) ? data.mismatches : [];
  if (mismatches.length > 0) {
    const fields = mismatches
      .map((field) => FARM_IDENTITY_LABELS[String(field)] ?? String(field))
      .join(" and ");
    parts.push(`FARM ${fields} differs from the drive's`);
  }
  return parts.join(" · ") || "SMART counters reset";
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
    label: "SMART attribute",
    category: "disk",
    subjectType: "disk",
    severities: ["warning", "error"],
    trigger:
      "The latest SMART reading of an in-service disk has an attribute that is not passing. Warning for the warning band, error for failed. One fault per attribute.",
    resolves:
      "The attribute passes again, or the disk leaves service. Acknowledging or accepting records the current value; the fault reopens if the value exceeds it.",
    lifetime: "persistent",
    actions: ["acknowledge", "accept", "clear"],
    title: smartAttributeTitle,
  },
  "smart-health-failed": {
    label: "SMART health failed",
    category: "disk",
    subjectType: "disk",
    severities: ["error"],
    trigger:
      "The latest SMART reading reports the drive's health self-assessment as failed.",
    resolves:
      "A later reading does not report failed, or the disk leaves service.",
    lifetime: "persistent",
    actions: ["acknowledge", "clear"],
    title: () => "SMART health check failed",
  },
  "disk-missing": {
    label: "Disk missing",
    category: "disk",
    subjectType: "disk",
    severities: ["error"],
    trigger:
      "An in-service disk is absent from its host's reports and was last seen within the last 7 days.",
    resolves:
      "The disk is seen again, or 7 days after it was last seen, when its state becomes removed. Setting a state override on the disk page (spare, removed, dead or retired) or disposing of the disk resolves it. Superseded by pool degraded or pool missing while either covers the disk.",
    lifetime: "transient",
    actions: ["acknowledge", "clear"],
    title: (data, now) => {
      const age = ageSince(data.lastSeenAt, now);
      return age ? `Missing, last seen ${age} ago` : "Missing";
    },
  },
  "identity-conflict": {
    label: "Identity conflict",
    category: "disk",
    subjectType: "disk",
    severities: ["error"],
    trigger: "Two disks reported the same serial number or WWN.",
    resolves: "Acknowledgement only. A later conflict opens a new fault.",
    lifetime: "until-acknowledged",
    actions: ["acknowledge"],
    title: (data) => {
      const others = typeof data.others === "string" ? data.others : "";
      return `Identity conflict with ${others || "another disk"}`;
    },
  },
  "temperature-high": {
    label: "Temperature high",
    category: "disk",
    subjectType: "disk",
    severities: ["warning", "error"],
    trigger:
      "A disk has been at or above its warning temperature for the hot-for window (default 60 min). Default thresholds: HDD 45 °C warning, 55 °C error; SSD 60 °C warning, 70 °C error. Error at or above the error temperature.",
    resolves:
      "The latest reading is more than 3 °C below the warning temperature. Error steps down to warning once more than 3 °C below the error temperature.",
    settings: [
      "Host settings › Temperature thresholds (°C)",
      "Host settings › Hot for (minutes)",
    ],
    lifetime: "transient",
    actions: ["acknowledge", "accept", "clear"],
    title: temperatureHighTitle,
  },
  "smart-counters-reset": {
    label: "SMART counters reset",
    category: "disk",
    subjectType: "disk",
    severities: ["warning"],
    trigger:
      "A Seagate FARM log reports more power-on hours than SMART, by more than 48 h or 5 % of the FARM figure, whichever is larger; or the FARM serial or WWN differs from the drive's. Either indicates reset SMART counters, as on some resold drives.",
    resolves:
      "FARM and SMART agree. An accepted fault reopens if the hours gap grows by more than 48 h or a further identity field differs.",
    lifetime: "persistent",
    actions: ["accept", "clear"],
    title: smartCountersResetTitle,
  },
  "pool-degraded": {
    label: "Pool degraded",
    category: "zfs",
    subjectType: "pool",
    severities: ["warning", "error"],
    trigger:
      "The pool or one of its leaf devices is not ONLINE (a spare in AVAIL counts as healthy). Error for FAULTED, UNAVAIL or SUSPENDED; warning for DEGRADED, OFFLINE, REMOVED or any other state.",
    resolves:
      "The pool and every device are ONLINE. An acknowledged or accepted fault reopens if a further device fails or a listed device's error counts rise.",
    lifetime: "transient",
    actions: ["acknowledge", "accept", "clear"],
    title: poolDegradedTitle,
  },
  "pool-missing": {
    label: "Pool missing",
    category: "zfs",
    subjectType: "pool",
    severities: ["warning"],
    trigger: "The host's latest zpool status does not include the pool.",
    resolves:
      "The pool is seen again, or is archived. Not raised while the host is silent, or while an intermittent host is offline. If the pool was exported or destroyed on purpose, accept the fault, or archive the pool to retire it.",
    lifetime: "until-seen-again",
    actions: ["acknowledge", "accept", "clear"],
    title: (data, now) => {
      const age = ageSince(data.lastSeenAt, now);
      const missing = `Pool ${text(data.poolName)} missing`;
      return age ? `${missing}, last seen ${age} ago` : missing;
    },
  },
  "leaf-errors": {
    label: "Device errors",
    category: "zfs",
    subjectType: "pool",
    severities: ["warning", "error"],
    trigger:
      "A device has read, write or checksum errors (warning), or a mirror or raidz group has errors not attributed to one device (error). Devices listed by pool degraded are covered there instead.",
    resolves:
      "Manual resolution only: falling counters are indistinguishable from a reboot or zpool clear. Reopens only if the counts rise after resolution.",
    lifetime: "until-resolved",
    actions: ["acknowledge", "accept", "clear", "resolve"],
    title: leafErrorsTitle,
  },
  "leaf-slow": {
    label: "Slow I/O",
    category: "zfs",
    subjectType: "pool",
    severities: ["warning"],
    trigger:
      "A device's slow I/O count rose by at least the pool's slow I/O threshold (default 10) in the last 24 h.",
    resolves:
      "The 24 h rise falls below the threshold. A threshold of 0 disables the check.",
    settings: ["Pool settings › Slow I/O threshold (per 24 h)"],
    lifetime: "transient",
    actions: ["acknowledge", "accept", "clear"],
    title: (data) =>
      `${leafLabel(data.name)} in ${text(data.poolName)}: ${plural(Number(data.rise24h), "slow I/O")} in 24 h`,
  },
  "pool-data-errors": {
    label: "Pool data errors",
    category: "zfs",
    subjectType: "pool",
    severities: ["error"],
    trigger:
      "The pool reports permanent data errors, or its latest finished scrub or resilver reported errors.",
    resolves:
      "The pool reports no data errors and the latest finished scan found none. An acknowledged fault reopens if the data error count rises or a later scan finds errors.",
    lifetime: "until-no-data-errors",
    actions: ["acknowledge", "clear"],
    title: poolDataErrorsTitle,
  },
  "scrub-overdue": {
    label: "Scrub overdue",
    category: "zfs",
    subjectType: "pool",
    severities: ["warning"],
    trigger:
      "No scrub has finished within the pool's scrub interval (default 35 days). A pool never scrubbed is measured from when it was first seen.",
    resolves:
      "A scrub finishes, or the interval is raised past the gap. An interval of 0 disables the check.",
    settings: ["Pool settings › Scrub interval (days)"],
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
    label: "Pool status message",
    category: "zfs",
    subjectType: "pool",
    severities: ["warning", "error"],
    trigger:
      "zpool status reports a message ID not covered by another fault kind. Error for ZFS-8000-A5 (incompatible version) and ZFS-8000-K4 (intent log read failure); warning for all others.",
    resolves: "The pool stops reporting the message ID.",
    lifetime: "transient",
    actions: ["acknowledge", "accept", "clear"],
    title: poolStatusTitle,
  },
  "scrub-paused": {
    label: "Scrub paused",
    category: "zfs",
    subjectType: "pool",
    severities: ["warning"],
    trigger: "A scrub has been paused for more than 24 h.",
    resolves: "The scrub resumes, finishes or is cancelled.",
    lifetime: "transient",
    actions: ["acknowledge", "accept", "clear"],
    title: (data, now) => {
      const age = ageSince(data.pausedAt, now);
      const paused = `Pool ${text(data.poolName)} scrub paused`;
      return age ? `${paused} for ${age}` : paused;
    },
  },
  "scan-stalled": {
    label: "Scan stalled",
    category: "zfs",
    subjectType: "pool",
    severities: ["warning", "error"],
    trigger:
      "A running scrub or resilver has reported no progress for 6 h. Warning for a scrub; error for a resilver, during which the pool is short of redundancy.",
    resolves: "The scan reports progress or ends.",
    lifetime: "transient",
    actions: ["acknowledge", "clear"],
    title: scanStalledTitle,
  },
  "vdev-unredundant": {
    label: "Single-device special vdev",
    category: "zfs",
    subjectType: "pool",
    severities: ["warning"],
    trigger:
      "A top-level special or dedup vdev is a single device; losing it loses the pool. Single log and cache devices are not flagged.",
    resolves: "The vdev is mirrored or removed.",
    lifetime: "transient",
    actions: ["acknowledge", "accept", "clear"],
    title: (data) =>
      `${text(data.role)} ${leafLabel(data.name)} in ${text(data.poolName)} is a single device`,
  },
  "pool-capacity": {
    label: "Pool capacity",
    category: "zfs",
    subjectType: "pool",
    severities: ["warning", "error"],
    trigger:
      "Allocation of the pool, or of a special or dedup vdev, is at or above the capacity warning (default 80 %) or error (default 90 %) threshold.",
    resolves:
      "Allocation falls more than 2 points below the threshold crossed; error steps down to warning on the same margin. A warning threshold of 0 disables the check.",
    settings: [
      "Pool settings › Capacity warning (%)",
      "Pool settings › Capacity error (%)",
    ],
    lifetime: "transient",
    actions: ["acknowledge", "accept", "clear"],
    title: poolCapacityTitle,
  },
  "replication-late": {
    label: "Replication late",
    category: "zfs",
    subjectType: "replication",
    severities: ["warning"],
    trigger:
      "A replication is overdue by more than 3 h or 0.5 × its interval, whichever is larger. The interval is the manual interval if set, otherwise the median gap between the last 10 syncs.",
    resolves:
      "A sync lands. Superseded by replication stalled or replication target gone.",
    settings: [
      "Settings › Replication › Late after (hours)",
      "Settings › Replication › Late factor (× interval)",
    ],
    lifetime: "transient",
    actions: ["acknowledge", "accept", "clear"],
    title: replicationTitle("late"),
  },
  "replication-stalled": {
    label: "Replication stalled",
    category: "zfs",
    subjectType: "replication",
    severities: ["error"],
    trigger:
      "A replication is overdue by more than 48 h or 2 × its interval, whichever is larger.",
    resolves: "A sync lands. Superseded by replication target gone.",
    settings: [
      "Settings › Replication › Stalled after (hours)",
      "Settings › Replication › Stalled factor (× interval)",
    ],
    lifetime: "transient",
    actions: ["acknowledge", "accept", "clear"],
    title: replicationTitle("stalled"),
  },
  "replication-target-gone": {
    label: "Replication target gone",
    category: "zfs",
    subjectType: "replication",
    severities: ["error"],
    trigger:
      "The target dataset no longer exists on a pool that is present and not archived.",
    resolves: "The dataset reappears, or the replication is archived.",
    lifetime: "transient",
    actions: ["acknowledge", "accept", "clear"],
    title: (data) =>
      `Replication target ${text(data.targetName)} no longer exists`,
  },
  "collector-silent": {
    label: "Collector silent",
    category: "host",
    subjectType: "host",
    severities: ["error"],
    trigger:
      "No collector group has reported within twice its cadence (ZFS 10 min; SMART and snapshots 1 h). Supersedes the host's pool faults while open.",
    resolves:
      "Any group reports. An intermittent host is shown offline instead and raises no fault.",
    settings: ["Host settings › Intermittent"],
    lifetime: "transient",
    actions: ["acknowledge", "clear"],
    title: (data, now) => {
      const age = ageSince(data.lastOkAt, now);
      return age ? `No data for ${age}` : "No data yet";
    },
  },
  "collector-incompatible": {
    label: "Collector incompatible",
    category: "host",
    subjectType: "host",
    severities: ["error"],
    trigger: `The host's collector is older than ${MIN_COLLECTOR_VERSION}, the oldest version the server accepts.`,
    resolves: "The collector is upgraded. The fault shows the upgrade command.",
    lifetime: "transient",
    actions: ["acknowledge", "clear"],
    upgradeCommand: true,
    title: (data) =>
      `Collector ${text(data.version)} is too old; ${text(data.minVersion)} or later is needed`,
  },
  "collector-outdated": {
    label: "Collector outdated",
    category: "host",
    subjectType: "host",
    severities: ["warning"],
    trigger: `The host's collector is accepted but older than the current version, ${COLLECTOR_VERSION}.`,
    resolves: "The collector is upgraded. The fault shows the upgrade command.",
    lifetime: "transient",
    actions: ["acknowledge", "clear"],
    upgradeCommand: true,
    title: (data) =>
      `Collector ${text(data.version)} is behind ${text(data.currentVersion) || COLLECTOR_VERSION}`,
  },
  "host-degraded": {
    label: "Host tools unsupported",
    category: "host",
    subjectType: "host",
    severities: ["warning"],
    trigger:
      "The host runs OpenZFS older than 2.3 (no pool, dataset or snapshot data) or smartmontools older than 7.0 (no SMART data).",
    resolves: "The tool is upgraded.",
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
  path: string | null;
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
