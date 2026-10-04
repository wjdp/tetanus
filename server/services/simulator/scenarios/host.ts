import { eq, sql } from "drizzle-orm";
import {
  COLLECTOR_VERSION,
  type CollectorStatus,
  collectorStatus,
  MIN_COLLECTOR_VERSION,
} from "#shared/collector";
import { SOURCE_GROUPS } from "#shared/hostFreshness";
import { HOST_TOOL_REQUIREMENTS, type HostTool } from "#shared/hostTools";
import type { ScenarioParamOption } from "#shared/simulator";
import { db } from "~~/server/database/client";
import { collectorRun, disk, host, pool } from "~~/server/database/schema";
import { getHost } from "~~/server/services/hosts";
import { collectorCadences } from "~~/server/utils/demo";
import { type StoredPayload, storedPayload, storedPayloads } from "../payloads";
import {
  defineScenario,
  type PlannedReplay,
  type Scenario,
  type SubjectOf,
} from "../types";

const HOUR_MS = 60 * 60 * 1000;

function okRunAges(subject: SubjectOf<"host">, now: Date) {
  return new Map(
    Object.entries(getHost(subject.host.id).lastRuns)
      .filter(([, run]) => run.ok)
      .map(([source, run]) => [
        source,
        now.getTime() - run.receivedAt.getTime(),
      ]),
  );
}

/** Hours since the latest run at which every source group has gone past twice its cadence. */
function silentAfterHours(subject: SubjectOf<"host">, now = new Date()) {
  const ages = okRunAges(subject, now);
  const latestAge = Math.min(...ages.values());
  const cadences = collectorCadences();
  const shiftNeeded = SOURCE_GROUPS.map((group) => {
    const groupAges = group.sources.flatMap((source) => ages.get(source) ?? []);
    if (groupAges.length === 0) return 0;
    const cadence = cadences[group.name] ?? group.cadenceMs;
    return 2 * cadence - Math.min(...groupAges);
  });
  return Math.max(
    1,
    Math.ceil((latestAge + Math.max(0, ...shiftNeeded)) / HOUR_MS + 0.01),
  );
}

/** Moves the host's whole collection history back, so its latest run is `hours` old; sightings move with it. */
function backdateHost(subject: SubjectOf<"host">, hours: number, now: Date) {
  const latestAge = Math.min(...okRunAges(subject, now).values());
  const shiftMs = hours * HOUR_MS - latestAge;
  if (shiftMs <= 0) return;
  const hostId = subject.host.id;
  db.update(collectorRun)
    .set({ receivedAt: sql`${collectorRun.receivedAt} - ${shiftMs}` })
    .where(eq(collectorRun.hostId, hostId))
    .run();
  db.update(host)
    .set({ lastSeenAt: sql`${host.lastSeenAt} - ${shiftMs}` })
    .where(eq(host.id, hostId))
    .run();
  db.update(disk)
    .set({ lastSeenAt: sql`${disk.lastSeenAt} - ${shiftMs}` })
    .where(eq(disk.lastSeenHostId, hostId))
    .run();
  db.update(pool)
    .set({ lastSeenAt: sql`${pool.lastSeenAt} - ${shiftMs}` })
    .where(eq(pool.hostId, hostId))
    .run();
}

export const collectorSilent = defineScenario({
  id: "collector-silent",
  label: "Collector silent",
  group: "Collector",
  subjectType: "host",
  description:
    "The collector stops posting. Its disks keep their state as of the last scan.",
  applies: (subject) =>
    !subject.host.intermittent && okRunAges(subject, new Date()).size > 0,
  params: (subject) => {
    const hours = silentAfterHours(subject);
    return [
      {
        key: "hours",
        label: "Last run",
        kind: "number",
        default: hours,
        min: hours,
        unit: "hours ago",
      },
    ];
  },
  plan: (subject, params) => ({
    replays: [],
    afterReplay: (now) => backdateHost(subject, Number(params.hours), now),
  }),
});

function versionParts(version: string) {
  return version.split(".").map(Number) as [number, number, number];
}

function nearbyVersions(version: string) {
  const [major, minor, patch] = versionParts(version);
  return [
    patch > 0 && `${major}.${minor}.${patch - 1}`,
    minor > 0 && `${major}.${minor - 1}.0`,
    major > 0 && `${major - 1}.0.0`,
  ].filter((each): each is string => Boolean(each));
}

function versionOptions(status: CollectorStatus): ScenarioParamOption[] {
  const candidates = [
    ...nearbyVersions(COLLECTOR_VERSION),
    MIN_COLLECTOR_VERSION,
    ...nearbyVersions(MIN_COLLECTOR_VERSION),
  ];
  return [...new Set(candidates)]
    .filter((version) => collectorStatus(version) === status)
    .map((version) => ({ value: version, label: version }));
}

function versionScenario(options: {
  id: string;
  label: string;
  status: CollectorStatus;
  description: string;
}) {
  return defineScenario({
    id: options.id,
    label: options.label,
    group: "Collector",
    subjectType: "host",
    description: options.description,
    applies: (subject) =>
      versionOptions(options.status).length > 0 &&
      storedPayload(subject.host.id, "versions") !== undefined,
    params: () => {
      const choices = versionOptions(options.status);
      return [
        {
          key: "version",
          label: "Version",
          kind: "select",
          default: choices[0]?.value ?? "",
          options: choices,
        },
      ];
    },
    plan: (subject, params) => {
      const stored = storedPayload(subject.host.id, "versions");
      if (!stored) throw new Error("No versions output stored for this host");
      return {
        replays: [
          { ...stored, producer: `tetanus-collect/${String(params.version)}` },
        ],
      };
    },
  });
}

export const collectorOutdated = versionScenario({
  id: "collector-outdated",
  label: "Collector outdated",
  status: "outdated",
  description: "The collector reports an older version that still works.",
});

export const collectorIncompatible = versionScenario({
  id: "collector-incompatible",
  label: "Collector incompatible",
  status: "incompatible",
  description: "The collector reports a version older than the server accepts.",
});

interface OldTool {
  label: string;
  versionLines: Record<string, string>;
  exitStatus: number;
  stderr: string;
}

const OLD_TOOLS: Record<HostTool, OldTool> = {
  openzfs: {
    label: "OpenZFS 2.2.2",
    versionLines: {
      zfs: "zfs-2.2.2-0ubuntu9.1",
      zpool: "zfs-2.2.2-0ubuntu9.1",
    },
    exitStatus: 2,
    stderr: "invalid option 'j'\nusage:\n",
  },
  smartmontools: {
    label: "smartmontools 6.6",
    versionLines: { smartctl: "smartctl 6.6 2017-11-05 r4594 [x86_64-linux]" },
    exitStatus: 1,
    stderr: "smartctl: unrecognized option '--json'\n",
  },
};

function withVersionLines(body: string, lines: Record<string, string>) {
  const replaced = body
    .split("\n")
    .filter((line) => !(line.split("=")[0] in lines));
  const added = Object.entries(lines).map(([key, value]) => `${key}=${value}`);
  return [...added, ...replaced.filter(Boolean), ""].join("\n");
}

function failedRun(stored: StoredPayload, old: OldTool): PlannedReplay {
  const { exitStatus: _exitStatus, ...meta } = stored.meta;
  return {
    ...stored,
    meta: { ...meta, failed: old.exitStatus },
    body: old.stderr,
  };
}

export const toolsUnsupported = defineScenario({
  id: "tools-unsupported",
  label: "Tools unsupported",
  group: "Collector",
  subjectType: "host",
  description:
    "The host reports an OpenZFS or smartmontools too old for JSON output; their sources fail and the host is degraded.",
  applies: (subject) =>
    storedPayload(subject.host.id, "versions") !== undefined,
  params: () => [
    {
      key: "tool",
      label: "Tool",
      kind: "select",
      default: "openzfs",
      options: Object.entries(OLD_TOOLS).map(([value, old]) => ({
        value,
        label: old.label,
      })),
    },
  ],
  plan: (subject, params) => {
    const hostId = subject.host.id;
    const stored = storedPayload(hostId, "versions");
    if (!stored) throw new Error("No versions output stored for this host");
    const tool = String(params.tool) as HostTool;
    const old = OLD_TOOLS[tool];
    const failures = HOST_TOOL_REQUIREMENTS[tool].sources.flatMap((source) =>
      storedPayloads(hostId, source).map((each) => failedRun(each, old)),
    );
    return {
      replays: [
        { ...stored, body: withVersionLines(stored.body, old.versionLines) },
        ...failures,
      ],
    };
  },
});

export const HOST_SCENARIOS: Scenario<"host">[] = [
  collectorSilent,
  collectorOutdated,
  collectorIncompatible,
  toolsUnsupported,
];
