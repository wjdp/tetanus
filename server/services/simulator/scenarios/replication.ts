import { eq } from "drizzle-orm";
import type { ReplicationStatus } from "#shared/replications";
import { db } from "~~/server/database/client";
import { dataset } from "~~/server/database/schema";
import {
  assessReplication,
  backdateSyncsOf,
  replicationContext,
} from "~~/server/services/replications";
import { storedPayload } from "../payloads";
import { hostOfDataset } from "../subjects";
import {
  defineScenario,
  type PlannedReplay,
  type Scenario,
  type SubjectOf,
} from "../types";

const HOUR_MS = 60 * 60 * 1000;
const PAST_THRESHOLD_MS = HOUR_MS / 2;
const REPLICATION = "Replication";

type Subject = SubjectOf<"replication">;
type Band = "late" | "stalled";

function assess(subject: Subject, now = new Date()) {
  const context = replicationContext([subject.replication], now);
  return {
    ...assessReplication(subject.replication, context),
    thresholds: context.thresholds,
  };
}

/** Whole hours to move the syncs back so the replication lands just past the band's threshold. */
function hoursIntoBand(subject: Subject, band: Band) {
  const { intervalMs, overdueMs, thresholds } = assess(subject);
  if (intervalMs === null || overdueMs === null) return 1;
  const [floorHours, factor] =
    band === "late"
      ? [thresholds.lateFloorHours, thresholds.lateFactor]
      : [thresholds.stalledFloorHours, thresholds.stalledFactor];
  const thresholdMs = Math.max(floorHours * HOUR_MS, factor * intervalMs);
  const shiftMs = thresholdMs + PAST_THRESHOLD_MS - overdueMs;
  return Math.max(1, Math.ceil(shiftMs / HOUR_MS));
}

function backdateScenario(
  band: Band,
  label: string,
  description: string,
  from: ReplicationStatus[],
) {
  return defineScenario({
    id: `replication-${band}`,
    label,
    group: REPLICATION,
    subjectType: "replication",
    description,
    applies: (subject) => from.includes(assess(subject).status),
    params: (subject) => [
      {
        key: "hours",
        label: "Syncs moved back",
        kind: "number",
        default: hoursIntoBand(subject, band),
        min: 1,
        unit: "hours",
      },
    ],
    plan: (subject, params) => ({
      replays: [],
      afterReplay: () =>
        backdateSyncsOf(subject.replication.id, Number(params.hours) * HOUR_MS),
    }),
  });
}

export const replicationLate = backdateScenario(
  "late",
  "Running late",
  "Syncs move back in time until the replication is overdue past the late threshold.",
  ["ok"],
);

export const replicationStalled = backdateScenario(
  "stalled",
  "Stalled",
  "Syncs move back in time until the replication is overdue past the stalled threshold.",
  ["ok", "late"],
);

function presentDataset(datasetId: number | null) {
  if (datasetId === null) return undefined;
  const found = db
    .select()
    .from(dataset)
    .where(eq(dataset.id, datasetId))
    .get();
  return found?.present ? found : undefined;
}

const withinDataset = (name: string, root: string) =>
  name === root || name.startsWith(`${root}/`);

/** The dataset's host's latest `zfs-list` without the dataset and its children. */
function listWithout(datasetId: number | null): PlannedReplay | undefined {
  const found = presentDataset(datasetId);
  if (!found) return undefined;
  const owner = hostOfDataset(found.id);
  const stored = owner && storedPayload(owner.id, "zfs-list");
  if (!owner || !stored) return undefined;
  const json = JSON.parse(stored.body) as {
    datasets?: Record<string, unknown>;
  };
  if (!json.datasets || !(found.name in json.datasets)) return undefined;
  const datasets = Object.fromEntries(
    Object.entries(json.datasets).filter(
      ([name]) => !withinDataset(name, found.name),
    ),
  );
  return {
    ...stored,
    hostName: owner.name,
    body: JSON.stringify({ ...json, datasets }),
  };
}

function destroyedScenario(
  side: "source" | "target",
  label: string,
  datasetOf: (subject: Subject) => number | null,
) {
  return defineScenario({
    id: `replication-${side}-destroyed`,
    label,
    group: REPLICATION,
    subjectType: "replication",
    description: `The ${side} dataset and its children drop out of their host's zfs list.`,
    applies: (subject) => listWithout(datasetOf(subject)) !== undefined,
    plan: (subject) => {
      const replay = listWithout(datasetOf(subject));
      if (!replay) throw new Error(`No ${side} dataset to destroy`);
      return { replays: [replay] };
    },
  });
}

export const targetDestroyed = destroyedScenario(
  "target",
  "Target dataset destroyed",
  (subject) => subject.replication.targetDatasetId,
);

export const sourceDestroyed = destroyedScenario(
  "source",
  "Source dataset destroyed",
  (subject) => subject.replication.sourceDatasetId,
);

export const REPLICATION_SCENARIOS: Scenario<"replication">[] = [
  replicationLate,
  replicationStalled,
  targetDestroyed,
  sourceDestroyed,
];
