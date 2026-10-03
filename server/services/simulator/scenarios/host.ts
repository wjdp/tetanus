import { eq, sql } from "drizzle-orm";
import {
  COLLECTOR_VERSION,
  type CollectorStatus,
  collectorStatus,
  MIN_COLLECTOR_VERSION,
} from "#shared/collector";
import { SOURCE_GROUPS } from "#shared/hostFreshness";
import type { ScenarioParamOption } from "#shared/simulator";
import { db } from "~~/server/database/client";
import { collectorRun, disk, host, pool } from "~~/server/database/schema";
import { getHost } from "~~/server/services/hosts";
import { collectorCadences } from "~~/server/utils/demo";
import { storedPayload } from "../payloads";
import { defineScenario, type Scenario, type SubjectOf } from "../types";

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

export const HOST_SCENARIOS: Scenario<"host">[] = [
  collectorSilent,
  collectorOutdated,
  collectorIncompatible,
];
