import { and, eq, gt, isNotNull, max } from "drizzle-orm";
import type { ScenarioParam, SimulationParams } from "#shared/simulator";
import { ZFS_MESSAGES } from "#shared/zfsMessages";
import { db } from "~~/server/database/client";
import {
  diaryEntry,
  pool as poolTable,
  vdev as vdevTable,
  zfsEvent,
} from "~~/server/database/schema";
import {
  backdateSyncsInto,
  hasReplicationsInto,
} from "~~/server/services/replications";
import { type StoredPayload, storedPayload } from "../payloads";
import { defineScenario, type Scenario, type SubjectOf } from "../types";
import {
  allocationClassMirrors,
  appendEreports,
  cacheLeaves,
  detachToSingle,
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
  poolGroups,
  poolLeaves,
  poolSpares,
  runScan,
  type ScanFunction,
  type StatusMessage,
  type StatusPool,
  type StatusVdev,
  setDataErrors,
  setGroupErrors,
  setLeafErrors,
  setListCapacity,
  setListFragmentation,
  setSlowIos,
  setStatusCapacity,
  showMessage,
  startResilver,
  statusPoolIn,
  suspendPool,
  UNCOVERED_STATUS_MESSAGES,
  useSpare,
  withoutStatusPool,
} from "../zpool";
import { backdateSighting, missingAfterHours } from "./presence";

type PoolSubject = SubjectOf<"pool">;

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
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

function vdevParam(
  key: string,
  label: string,
  vdevs: StatusVdev[],
): ScenarioParam {
  return {
    key,
    label,
    kind: "select",
    default: vdevs[0]?.name ?? "",
    options: vdevs.map((vdev) => ({
      value: vdev.name,
      label: leafLabel(vdev),
    })),
  };
}

function leafParam(subject: PoolSubject, label = "Leaf"): ScenarioParam {
  return vdevParam("leaf", label, poolLeaves(statusPool(subject)));
}

const hasLeaves = (subject: PoolSubject) =>
  hasStatus(subject) && poolLeaves(statusPool(subject)).length > 0;

/** Present leaves of the pool linked to a disk, by guid. */
function leafDisks(subject: PoolSubject): Map<string, number> {
  return new Map(
    db
      .select({ guid: vdevTable.guid, diskId: vdevTable.diskId })
      .from(vdevTable)
      .where(
        and(
          eq(vdevTable.poolId, subject.pool.id),
          eq(vdevTable.present, true),
          isNotNull(vdevTable.diskId),
        ),
      )
      .all()
      .map((row) => [row.guid, row.diskId as number]),
  );
}

function leavesWithDisks(subject: PoolSubject): StatusVdev[] {
  const disks = leafDisks(subject);
  return poolLeaves(statusPool(subject)).filter((leaf) =>
    disks.has(leaf.guid ?? ""),
  );
}

const DATA_GROUP_TYPES = new Set(["mirror", "raidz"]);

function dataGroups(subject: PoolSubject): StatusVdev[] {
  return poolGroups(statusPool(subject)).filter((group) =>
    DATA_GROUP_TYPES.has(group.vdev_type ?? ""),
  );
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
const REPLICATION = "Replication";

export const leafFails = defineScenario({
  id: "leaf-fails",
  label: "Leaf fails",
  group: STATE,
  subjectType: "pool",
  description:
    "A disk in the pool fails; the vdev and pool degrade, or become unavailable past redundancy.",
  applies: hasLeaves,
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

export const diskPulled = defineScenario({
  id: "disk-pulled",
  label: "Disk pulled",
  group: STATE,
  subjectType: "pool",
  description:
    "A member disk is pulled from the host: its leaf goes REMOVED and the disk stops appearing.",
  applies: (subject) =>
    hasStatus(subject) && leavesWithDisks(subject).length > 0,
  params: (subject) => [vdevParam("leaf", "Leaf", leavesWithDisks(subject))],
  plan: (subject, params) => {
    const leaf = statusPool(subject).vdevs[leafOf(params)];
    const diskId = leafDisks(subject).get(leaf?.guid ?? "");
    if (diskId === undefined) throw new Error("No disk behind this leaf");
    return {
      replays: [
        editStatus(subject, (pool) =>
          failLeaf(pool, leafOf(params), "REMOVED"),
        ),
      ],
      afterReplay: (now) =>
        backdateSighting(
          diskId,
          subject.host.id,
          Math.min(48, missingAfterHours()),
          now,
        ),
    };
  },
});

export const cacheFails = defineScenario({
  id: "cache-fails",
  label: "Cache device fails",
  group: STATE,
  subjectType: "pool",
  description:
    "An L2ARC device becomes unavailable; the pool itself stays ONLINE.",
  applies: (subject) =>
    hasStatus(subject) && cacheLeaves(statusPool(subject)).length > 0,
  params: (subject) => [
    vdevParam("leaf", "Cache device", cacheLeaves(statusPool(subject))),
  ],
  plan: (subject, params) => ({
    replays: [
      editStatus(subject, (pool) => failLeaf(pool, leafOf(params), "UNAVAIL")),
    ],
  }),
});

export const poolVanishes = defineScenario({
  id: "pool-vanishes",
  label: "Pool vanishes",
  group: STATE,
  subjectType: "pool",
  description:
    "The pool drops out of zpool status, as after a failed import or an export.",
  applies: hasStatus,
  plan: (subject) => ({
    replays: [
      withoutStatusPool(
        requireStored(subject, "zpool-status"),
        subject.pool.name,
      ),
    ],
  }),
});

export const specialUnredundant = defineScenario({
  id: "special-unredundant",
  label: "Unredundant special vdev",
  group: STATE,
  subjectType: "pool",
  description:
    "Every side but one is detached from a special or dedup mirror; losing that device loses the pool.",
  applies: (subject) =>
    hasStatus(subject) &&
    allocationClassMirrors(statusPool(subject)).length > 0,
  params: (subject) => [
    vdevParam("group", "Mirror", allocationClassMirrors(statusPool(subject))),
  ],
  plan: (subject, params) => ({
    replays: [
      editStatus(subject, (pool) => detachToSingle(pool, String(params.group))),
    ],
  }),
});

const UNCOVERED_MSGIDS = Object.entries(ZFS_MESSAGES)
  .filter(([, message]) => "severity" in message)
  .map(([msgid, message]) => ({ msgid, title: message.title }));

function uncoveredMessage(msgid: string): StatusMessage {
  const title =
    UNCOVERED_MSGIDS.find((each) => each.msgid === msgid)?.title ?? msgid;
  return (
    UNCOVERED_STATUS_MESSAGES[msgid] ?? {
      status: `${title}.\n`,
      action: "See the linked message for the recovery steps.\n",
      msgid,
    }
  );
}

export const poolStatusMessage = defineScenario({
  id: "pool-status",
  label: "Status message",
  group: STATE,
  subjectType: "pool",
  description:
    "zpool status reports a message no other fault covers, such as a hostid mismatch.",
  applies: hasStatus,
  params: () => [
    {
      key: "msgid",
      label: "Message",
      kind: "select",
      default: "ZFS-8000-EY",
      options: UNCOVERED_MSGIDS.map(({ msgid, title }) => ({
        value: msgid,
        label: `${msgid.replace("ZFS-8000-", "")}: ${title}`,
      })),
    },
  ],
  plan: (subject, params) => ({
    replays: [
      editStatus(subject, (pool) =>
        showMessage(pool, uncoveredMessage(String(params.msgid))),
      ),
    ],
  }),
});

export const spareInUse = defineScenario({
  id: "spare-in-use",
  label: "Spare in use",
  group: STATE,
  subjectType: "pool",
  description: "A leaf faults and a hot spare takes its place.",
  applies: (subject) =>
    hasStatus(subject) && poolSpares(statusPool(subject)).length > 0,
  params: (subject) => [
    vdevParam(
      "leaf",
      "Failed leaf",
      poolLeaves(statusPool(subject)).filter(
        (leaf) => (leaf.class ?? "normal") === "normal",
      ),
    ),
    vdevParam("spare", "Spare", poolSpares(statusPool(subject))),
  ],
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
  applies: hasLeaves,
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

export const scrubRepaired = defineScenario({
  id: "scrub-repaired",
  label: "Scrub repaired data",
  group: ERRORS_AND_SCANS,
  subjectType: "pool",
  description:
    "A scrub finishes now with no errors after repairing what a leaf's checksum errors damaged.",
  applies: hasLeaves,
  params: (subject) => [
    leafParam(subject),
    numberParam("checksum", "Checksum errors", 6, { min: 1 }),
    numberParam("repaired", "Repaired", 64, { min: 1, unit: "MiB" }),
  ],
  plan: (subject, params, now) => ({
    replays: [
      editStatus(subject, (pool) => {
        finishScrub(pool, {
          endedAt: now,
          errors: 0,
          repairedBytes: Number(params.repaired) * MIB,
        });
        setLeafErrors(pool, leafOf(params), {
          read: 0,
          write: 0,
          checksum: Number(params.checksum),
        });
      }),
    ],
  }),
});

export const groupChecksumErrors = defineScenario({
  id: "group-checksum-errors",
  label: "Checksum errors on a group",
  group: ERRORS_AND_SCANS,
  subjectType: "pool",
  description:
    "A mirror or raidz counts checksum errors itself: data it could not reconstruct from its leaves.",
  applies: (subject) => hasStatus(subject) && dataGroups(subject).length > 0,
  params: (subject) => [
    vdevParam("group", "Group", dataGroups(subject)),
    numberParam("checksum", "Checksum errors", 4, { min: 1 }),
  ],
  plan: (subject, params) => ({
    replays: [
      editStatus(subject, (pool) =>
        setGroupErrors(pool, String(params.group), {
          read: 0,
          write: 0,
          checksum: Number(params.checksum),
        }),
      ),
    ],
  }),
});

export const slowIos = defineScenario({
  id: "slow-ios",
  label: "Slow I/Os",
  group: ERRORS_AND_SCANS,
  subjectType: "pool",
  description:
    "A leaf's slow I/O counter jumps, as a dying disk's long retries do.",
  applies: hasLeaves,
  params: (subject) => [
    leafParam(subject),
    numberParam("added", "Slow I/Os added", 20, { min: 1 }),
  ],
  plan: (subject, params) => ({
    replays: [
      editStatus(subject, (pool) => {
        const current = Number(pool.vdevs[leafOf(params)]?.slow_ios ?? 0);
        setSlowIos(pool, leafOf(params), current + Number(params.added));
      }),
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
  applies: hasLeaves,
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

export const scrubPaused = defineScenario({
  id: "scrub-paused",
  label: "Scrub paused",
  group: ERRORS_AND_SCANS,
  subjectType: "pool",
  description: "A scrub was paused (zpool scrub -p) and never resumed.",
  applies: hasStatus,
  params: () => [
    numberParam("hours", "Paused", 30, { min: 1, unit: "hours ago" }),
    numberParam("progress", "Progress", 40, { min: 0, max: 99, unit: "%" }),
  ],
  plan: (subject, params, now) => ({
    replays: [
      editStatus(subject, (pool) =>
        runScan(pool, {
          function: "SCRUB",
          percent: Number(params.progress),
          movedAt: new Date(now.getTime() - Number(params.hours) * HOUR_MS),
          paused: true,
        }),
      ),
    ],
  }),
});

const SCAN_FUNCTIONS: ScanFunction[] = ["SCRUB", "RESILVER"];

export const scanStalled = defineScenario({
  id: "scan-stalled",
  label: "Scan stalled",
  group: ERRORS_AND_SCANS,
  subjectType: "pool",
  description:
    "A scrub or resilver is running but has made no progress for hours.",
  applies: hasStatus,
  params: () => [
    {
      key: "function",
      label: "Scan",
      kind: "select",
      default: "SCRUB",
      options: SCAN_FUNCTIONS.map((each) => ({
        value: each,
        label: each.toLowerCase(),
      })),
    },
    numberParam("hours", "No progress for", 8, { min: 1, unit: "hours" }),
  ],
  plan: (subject, params, now) => {
    const movedAt = new Date(now.getTime() - Number(params.hours) * HOUR_MS);
    return {
      replays: [
        editStatus(subject, (pool) =>
          runScan(pool, {
            function: params.function as ScanFunction,
            percent: 40,
            movedAt,
          }),
        ),
      ],
      afterReplay: () => {
        db.update(poolTable)
          .set({ scanProgressAt: movedAt })
          .where(eq(poolTable.id, subject.pool.id))
          .run();
      },
    };
  },
});

/** Scrubs after `endedAt` never happened: their diary entries go and the last scrub moves back. */
function forgetScrubsAfter(poolId: number, lastScrubEnd: Date) {
  db.delete(diaryEntry)
    .where(
      and(
        eq(diaryEntry.subjectType, "pool"),
        eq(diaryEntry.subjectId, poolId),
        eq(diaryEntry.eventType, "scrub-finished"),
        gt(diaryEntry.at, lastScrubEnd),
      ),
    )
    .run();
  const row = db
    .select({ lastScrub: poolTable.lastScrub })
    .from(poolTable)
    .where(eq(poolTable.id, poolId))
    .get();
  if (!row?.lastScrub) return;
  db.update(poolTable)
    .set({
      lastScrub: { ...row.lastScrub, endAt: lastScrubEnd.toISOString() },
    })
    .where(eq(poolTable.id, poolId))
    .run();
}

export const scrubOverdue = defineScenario({
  id: "scrub-overdue",
  label: "Scrub overdue",
  group: ERRORS_AND_SCANS,
  subjectType: "pool",
  description:
    "The last finished scrub is backdated and later scrubs are forgotten.",
  applies: hasStatus,
  params: () => [
    numberParam("days", "Last scrub", 60, { min: 1, unit: "days ago" }),
  ],
  plan: (subject, params, now) => {
    const endedAt = new Date(now.getTime() - Number(params.days) * DAY_MS);
    return {
      replays: [
        editStatus(subject, (pool) =>
          finishScrub(pool, { endedAt, errors: 0, repairedBytes: 0 }),
        ),
      ],
      afterReplay: () => forgetScrubsAfter(subject.pool.id, endedAt),
    };
  },
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
    storedEvents(subject) !== undefined && hasLeaves(subject),
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

export const replicationStalls = defineScenario({
  id: "replication-stalls",
  label: "Replication stalls",
  group: REPLICATION,
  subjectType: "pool",
  description:
    "Receives into this pool stop: its replications' syncs move back in time.",
  applies: (subject) => hasReplicationsInto(subject.pool.id),
  params: () => [
    numberParam("hours", "Syncs moved back", 96, { min: 1, unit: "hours" }),
  ],
  plan: (subject, params) => ({
    replays: [],
    afterReplay: () =>
      backdateSyncsInto(subject.pool.id, Number(params.hours) * HOUR_MS),
  }),
});

export const POOL_SCENARIOS: Scenario<"pool">[] = [
  leafFails,
  diskPulled,
  cacheFails,
  poolSuspended,
  spareInUse,
  poolVanishes,
  specialUnredundant,
  poolStatusMessage,
  scrubFoundErrors,
  scrubRepaired,
  leafChecksumErrors,
  groupChecksumErrors,
  slowIos,
  permanentErrors,
  resilverInProgress,
  scrubPaused,
  scanStalled,
  scrubOverdue,
  nearlyFull,
  fragmented,
  errorBurst,
  replicationStalls,
];
