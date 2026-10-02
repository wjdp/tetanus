import { eq, max } from "drizzle-orm";
import type { ScenarioParam, SimulationParams } from "#shared/simulator";
import { db } from "~~/server/database/client";
import { zfsEvent } from "~~/server/database/schema";
import { type StoredPayload, storedPayload } from "../payloads";
import { defineScenario, type Scenario, type SubjectOf } from "../types";
import {
  appendEreports,
  EREPORT_CLASSES,
  type EreportClass,
  editListPool,
  editStatusPool,
  ereportLeaf,
  failLeaf,
  finishScrub,
  hasPool,
  LEAF_FAILURE_STATES,
  type LeafFailureState,
  type ListPool,
  leafLabel,
  poolLeaves,
  poolSpares,
  type StatusPool,
  setDataErrors,
  setLeafErrors,
  setListCapacity,
  setListFragmentation,
  setStatusCapacity,
  startResilver,
  statusPoolIn,
  suspendPool,
  useSpare,
} from "../zpool";

type PoolSubject = SubjectOf<"pool">;

const DAY_MS = 24 * 60 * 60 * 1000;
const MIB = 1024 ** 2;

function stored(subject: PoolSubject, source: "zpool-status" | "zpool-list") {
  const found = storedPayload(subject.host.id, source);
  return found && hasPool(found.body, subject.pool.name) ? found : undefined;
}

function requireStored(
  subject: PoolSubject,
  source: "zpool-status" | "zpool-list",
): StoredPayload {
  const found = stored(subject, source);
  if (!found) throw new Error(`No ${source} output stored for this pool`);
  return found;
}

function statusPool(subject: PoolSubject): StatusPool {
  return statusPoolIn(
    requireStored(subject, "zpool-status").body,
    subject.pool.name,
  );
}

const hasStatus = (subject: PoolSubject) =>
  stored(subject, "zpool-status") !== undefined;

function editStatus(subject: PoolSubject, edit: (pool: StatusPool) => void) {
  return editStatusPool(
    requireStored(subject, "zpool-status"),
    subject.pool.name,
    edit,
  );
}

function editList(subject: PoolSubject, edit: (pool: ListPool) => void) {
  return editListPool(
    requireStored(subject, "zpool-list"),
    subject.pool.name,
    edit,
  );
}

function leafParam(subject: PoolSubject, label = "Leaf"): ScenarioParam {
  const leaves = poolLeaves(statusPool(subject));
  return {
    key: "leaf",
    label,
    kind: "select",
    default: leaves[0]?.name ?? "",
    options: leaves.map((leaf) => ({
      value: leaf.name,
      label: leafLabel(leaf),
    })),
  };
}

function numberParam(
  key: string,
  label: string,
  defaultValue: number,
  limits: { min?: number; max?: number; unit?: string } = {},
): ScenarioParam {
  return { key, label, kind: "number", default: defaultValue, ...limits };
}

const leafOf = (params: SimulationParams) => String(params.leaf);

const STATE = "State";
const ERRORS_AND_SCANS = "Errors and scans";
const CAPACITY = "Capacity";
const EVENTS = "Events";

export const leafFails = defineScenario({
  id: "leaf-fails",
  label: "Leaf fails",
  group: STATE,
  subjectType: "pool",
  description:
    "A disk in the pool fails; the vdev and pool degrade, or become unavailable past redundancy.",
  applies: (subject) =>
    hasStatus(subject) && poolLeaves(statusPool(subject)).length > 0,
  params: (subject) => [
    leafParam(subject),
    {
      key: "state",
      label: "State",
      kind: "select",
      default: "FAULTED",
      options: LEAF_FAILURE_STATES.map((state) => ({
        value: state,
        label: state,
      })),
    },
  ],
  plan: (subject, params) => ({
    replays: [
      editStatus(subject, (pool) =>
        failLeaf(pool, leafOf(params), params.state as LeafFailureState),
      ),
    ],
  }),
});

export const poolSuspended = defineScenario({
  id: "pool-suspended",
  label: "Pool suspended",
  group: STATE,
  subjectType: "pool",
  description:
    "I/O failures past the first vdev's redundancy; ZFS suspends the pool.",
  applies: hasStatus,
  plan: (subject) => ({ replays: [editStatus(subject, suspendPool)] }),
});

export const spareInUse = defineScenario({
  id: "spare-in-use",
  label: "Spare in use",
  group: STATE,
  subjectType: "pool",
  description: "A leaf faults and a hot spare takes its place.",
  applies: (subject) =>
    hasStatus(subject) && poolSpares(statusPool(subject)).length > 0,
  params: (subject) => {
    const spares = poolSpares(statusPool(subject));
    return [
      leafParam(subject, "Failed leaf"),
      {
        key: "spare",
        label: "Spare",
        kind: "select",
        default: spares[0]?.name ?? "",
        options: spares.map((spare) => ({
          value: spare.name,
          label: leafLabel(spare),
        })),
      },
    ];
  },
  plan: (subject, params) => ({
    replays: [
      editStatus(subject, (pool) =>
        useSpare(pool, leafOf(params), String(params.spare)),
      ),
    ],
  }),
});

export const scrubFoundErrors = defineScenario({
  id: "scrub-found-errors",
  label: "Scrub found errors",
  group: ERRORS_AND_SCANS,
  subjectType: "pool",
  description:
    "A scrub finishes now with unrecoverable errors, leaving permanent errors in files.",
  applies: hasStatus,
  params: () => [
    numberParam("errors", "Errors", 3, { min: 1 }),
    numberParam("repaired", "Repaired", 64, { min: 0, unit: "MiB" }),
  ],
  plan: (subject, params, now) => ({
    replays: [
      editStatus(subject, (pool) => {
        finishScrub(pool, {
          endedAt: now,
          errors: Number(params.errors),
          repairedBytes: Number(params.repaired) * MIB,
        });
        setDataErrors(pool, Number(params.errors));
      }),
    ],
  }),
});

export const leafChecksumErrors = defineScenario({
  id: "leaf-checksum-errors",
  label: "Checksum errors on a leaf",
  group: ERRORS_AND_SCANS,
  subjectType: "pool",
  description:
    "A leaf reports read, write or checksum errors; the pool stays ONLINE.",
  applies: (subject) =>
    hasStatus(subject) && poolLeaves(statusPool(subject)).length > 0,
  params: (subject) => [
    leafParam(subject),
    numberParam("read", "Read errors", 0, { min: 0 }),
    numberParam("write", "Write errors", 0, { min: 0 }),
    numberParam("checksum", "Checksum errors", 12, { min: 0 }),
  ],
  plan: (subject, params) => ({
    replays: [
      editStatus(subject, (pool) =>
        setLeafErrors(pool, leafOf(params), {
          read: Number(params.read),
          write: Number(params.write),
          checksum: Number(params.checksum),
        }),
      ),
    ],
  }),
});

export const permanentErrors = defineScenario({
  id: "permanent-errors",
  label: "Permanent errors in files",
  group: ERRORS_AND_SCANS,
  subjectType: "pool",
  description:
    "The pool's error log lists files with unrecoverable data errors.",
  applies: hasStatus,
  params: () => [numberParam("count", "Data errors", 2, { min: 1 })],
  plan: (subject, params) => ({
    replays: [
      editStatus(subject, (pool) => setDataErrors(pool, Number(params.count))),
    ],
  }),
});

export const resilverInProgress = defineScenario({
  id: "resilver-in-progress",
  label: "Resilver in progress",
  group: ERRORS_AND_SCANS,
  subjectType: "pool",
  description: "A leaf rejoins and resilvers.",
  applies: (subject) =>
    hasStatus(subject) && poolLeaves(statusPool(subject)).length > 0,
  params: (subject) => [
    leafParam(subject),
    numberParam("progress", "Progress", 40, { min: 0, max: 99, unit: "%" }),
  ],
  plan: (subject, params, now) => ({
    replays: [
      editStatus(subject, (pool) =>
        startResilver(pool, leafOf(params), Number(params.progress), now),
      ),
    ],
  }),
});

export const scrubOverdue = defineScenario({
  id: "scrub-overdue",
  label: "Scrub overdue",
  group: ERRORS_AND_SCANS,
  subjectType: "pool",
  description: "The last finished scrub is backdated.",
  applies: hasStatus,
  params: () => [
    numberParam("days", "Last scrub", 60, { min: 1, unit: "days ago" }),
  ],
  plan: (subject, params, now) => ({
    replays: [
      editStatus(subject, (pool) =>
        finishScrub(pool, {
          endedAt: new Date(now.getTime() - Number(params.days) * DAY_MS),
          errors: 0,
          repairedBytes: 0,
        }),
      ),
    ],
  }),
});

const hasListAndStatus = (subject: PoolSubject) =>
  hasStatus(subject) && stored(subject, "zpool-list") !== undefined;

export const nearlyFull = defineScenario({
  id: "nearly-full",
  label: "Nearly full",
  group: CAPACITY,
  subjectType: "pool",
  applies: hasListAndStatus,
  params: () => [
    numberParam("cap", "Capacity", 92, { min: 0, max: 100, unit: "%" }),
  ],
  plan: (subject, params) => ({
    replays: [
      editList(subject, (pool) => setListCapacity(pool, Number(params.cap))),
      editStatus(subject, (pool) =>
        setStatusCapacity(pool, Number(params.cap)),
      ),
    ],
  }),
});

export const fragmented = defineScenario({
  id: "fragmented",
  label: "Fragmented",
  group: CAPACITY,
  subjectType: "pool",
  applies: hasListAndStatus,
  params: () => [
    numberParam("frag", "Fragmentation", 70, { min: 0, max: 100, unit: "%" }),
  ],
  plan: (subject, params) => ({
    replays: [
      editList(subject, (pool) =>
        setListFragmentation(pool, Number(params.frag)),
      ),
      requireStored(subject, "zpool-status"),
    ],
  }),
});

function storedEvents(subject: PoolSubject) {
  return storedPayload(subject.host.id, "zpool-events");
}

function newestStoredEid(hostId: number): number {
  return (
    db
      .select({ value: max(zfsEvent.eid) })
      .from(zfsEvent)
      .where(eq(zfsEvent.hostId, hostId))
      .get()?.value ?? 0
  );
}

export const errorBurst = defineScenario({
  id: "error-burst",
  label: "Error burst",
  group: EVENTS,
  subjectType: "pool",
  description: "A run of ZFS error reports against one leaf, timed now.",
  applies: (subject) =>
    storedEvents(subject) !== undefined &&
    hasStatus(subject) &&
    poolLeaves(statusPool(subject)).length > 0,
  params: (subject) => [
    leafParam(subject),
    {
      key: "class",
      label: "Class",
      kind: "select",
      default: EREPORT_CLASSES[0],
      options: EREPORT_CLASSES.map((eventClass) => ({
        value: eventClass,
        label: eventClass,
      })),
    },
    numberParam("count", "Events", 10, { min: 1, max: 200 }),
  ],
  plan: (subject, params, now) => {
    const events = storedEvents(subject);
    if (!events) throw new Error("No zpool-events output stored for this host");
    const pool = statusPool(subject);
    return {
      replays: [
        {
          ...events,
          body: appendEreports(events.body, {
            eventClass: params.class as EreportClass,
            pool: {
              name: pool.name,
              guid: pool.pool_guid ?? subject.pool.guid,
            },
            leaf: ereportLeaf(pool, leafOf(params)),
            count: Number(params.count),
            at: now,
            afterEid: newestStoredEid(subject.host.id),
          }),
        },
      ],
    };
  },
});

export const POOL_SCENARIOS: Scenario<"pool">[] = [
  leafFails,
  poolSuspended,
  spareInUse,
  scrubFoundErrors,
  leafChecksumErrors,
  permanentErrors,
  resilverInProgress,
  scrubOverdue,
  nearlyFull,
  fragmented,
  errorBurst,
];
