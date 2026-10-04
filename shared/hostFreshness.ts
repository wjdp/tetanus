import type { IngestSource } from "#shared/ingest";

export type SourceGroupName = "zfs" | "smart" | "snapshots";

interface SourceGroup {
  name: SourceGroupName;
  sources: readonly IngestSource[];
  cadenceMs: number;
}

// Cadence per 010's host collector table. `zed-event` is event-driven, not
// polled, so it carries no cadence and never turns a chip amber.
export const SOURCE_GROUPS: readonly SourceGroup[] = [
  {
    name: "zfs",
    sources: [
      "versions",
      "zpool-status",
      "zpool-list",
      "zfs-list",
      "zpool-history",
      "zfs-receives",
      "zpool-events",
      "vdev-id-conf",
    ],
    cadenceMs: 10 * 60 * 1000,
  },
  {
    name: "smart",
    sources: ["lsblk", "udev", "enclosure", "smartctl-scan", "smartctl-xall"],
    cadenceMs: 60 * 60 * 1000,
  },
  {
    name: "snapshots",
    sources: ["zfs-snapshots"],
    cadenceMs: 60 * 60 * 1000,
  },
];

export const MONITORED_SOURCES: readonly IngestSource[] = SOURCE_GROUPS.flatMap(
  (group) => group.sources,
);

export function groupFor(source: string): SourceGroup | undefined {
  return SOURCE_GROUPS.find((group) =>
    (group.sources as readonly string[]).includes(source),
  );
}

export type CadenceOverrides = Partial<Record<SourceGroupName, number>>;

export const DEMO_CADENCES: CadenceOverrides = {
  zfs: 60 * 60 * 1000,
  smart: 60 * 60 * 1000,
  snapshots: 6 * 60 * 60 * 1000,
};

const cadenceOf = (group: SourceGroup, cadences: CadenceOverrides) =>
  cadences[group.name] ?? group.cadenceMs;

export type FreshnessStatus = "ok" | "warning" | "error";

export interface RunLike {
  receivedAt: Date | string;
  ok: boolean;
}

export interface SourceFreshness {
  source: string;
  status: FreshnessStatus;
  ageMs: number | null;
  lastSeenAt: Date | null;
}

export function sourceFreshness(
  source: string,
  run: RunLike | undefined,
  now: number,
  cadences: CadenceOverrides = {},
): SourceFreshness {
  if (!run?.ok) {
    return {
      source,
      status: "error",
      ageMs: null,
      lastSeenAt: run ? new Date(run.receivedAt) : null,
    };
  }
  const lastSeenAt = new Date(run.receivedAt);
  const ageMs = now - lastSeenAt.getTime();
  const group = groupFor(source);
  const status: FreshnessStatus =
    group && ageMs > cadenceOf(group, cadences) * 2 ? "warning" : "ok";
  return { source, status, ageMs, lastSeenAt };
}

export interface GroupFreshness {
  name: SourceGroupName;
  status: FreshnessStatus;
  ageMs: number | null;
  lastSeenAt: Date | null;
}

// One chip per cadence group rather than per source: the group's most
// recently succeeded source stands for the whole group, "error" only when
// nothing in the group has ever succeeded.
export function groupFreshness(
  group: SourceGroup,
  lastRuns: Record<string, RunLike | undefined>,
  now: number,
  cadences: CadenceOverrides = {},
): GroupFreshness {
  let best: { lastSeenAt: Date; ageMs: number } | null = null;
  for (const source of group.sources) {
    const run = lastRuns[source];
    if (!run?.ok) continue;
    const lastSeenAt = new Date(run.receivedAt);
    const ageMs = now - lastSeenAt.getTime();
    if (!best || ageMs < best.ageMs) best = { lastSeenAt, ageMs };
  }
  if (!best) {
    return { name: group.name, status: "error", ageMs: null, lastSeenAt: null };
  }
  const status: FreshnessStatus =
    best.ageMs > cadenceOf(group, cadences) * 2 ? "warning" : "ok";
  return {
    name: group.name,
    status,
    ageMs: best.ageMs,
    lastSeenAt: best.lastSeenAt,
  };
}

export function allGroupFreshness(
  lastRuns: Record<string, RunLike | undefined>,
  now: number,
  cadences: CadenceOverrides = {},
): GroupFreshness[] {
  return SOURCE_GROUPS.map((group) =>
    groupFreshness(group, lastRuns, now, cadences),
  );
}

export function isEveryGroupSilent(
  groups: readonly Pick<GroupFreshness, "status">[],
): boolean {
  return groups.every((group) => group.status !== "ok");
}

export function isHostOffline(
  host: {
    intermittent: boolean;
    lastRuns: Record<string, RunLike | undefined>;
  },
  now: number,
  cadences: CadenceOverrides = {},
): boolean {
  return (
    host.intermittent &&
    isEveryGroupSilent(allGroupFreshness(host.lastRuns, now, cadences))
  );
}

export function isHostSilent(
  host: {
    intermittent: boolean;
    lastRuns: Record<string, RunLike | undefined>;
  },
  now: number,
  cadences: CadenceOverrides = {},
): boolean {
  return (
    !isHostOffline(host, now, cadences) &&
    isEveryGroupSilent(allGroupFreshness(host.lastRuns, now, cadences))
  );
}

export function formatDuration(ms: number): string {
  const minutes = Math.max(1, Math.round(ms / 60_000));
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h`;
  const days = Math.round(hours / 24);
  return `${days} d`;
}
