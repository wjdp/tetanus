import type { StoredPayload } from "./payloads";

type Json = Record<string, unknown>;

export interface StatusVdev extends Json {
  name: string;
  vdev_type?: string;
  guid?: string;
  path?: string;
  devid?: string;
  phys_path?: string;
  class?: string;
  state?: string;
  parent?: string;
  aux?: string;
  read_errors?: number;
  write_errors?: number;
  checksum_errors?: number;
  slow_ios?: number;
  alloc_space?: number;
  total_space?: number;
  def_space?: number;
  vdevs?: Record<string, StatusVdev>;
}

export interface ScanStats extends Json {
  function: string;
  state: string;
  start_time: number;
  end_time: number;
  to_examine: number;
  examined: number;
  processed: number;
  errors: number;
}

export interface StatusPool extends Json {
  name: string;
  state: string;
  pool_guid?: string;
  status?: string;
  action?: string;
  msgid?: string;
  moreinfo?: string;
  scan_stats?: ScanStats;
  vdevs: Record<string, StatusVdev>;
  error_count?: number | string;
  errlist?: string[] | string;
}

interface ListProperty {
  value: number | string;
  source: Json;
}

interface ListEntry extends Json {
  class?: string;
  properties: Record<string, ListProperty>;
}

export interface ListPool extends ListEntry {
  vdevs?: Record<string, ListEntry | Record<string, ListEntry>>;
}

export const LEAF_FAILURE_STATES = [
  "FAULTED",
  "UNAVAIL",
  "REMOVED",
  "OFFLINE",
] as const;
export type LeafFailureState = (typeof LEAF_FAILURE_STATES)[number];

const UNHEALTHY_STATES = new Set<string>(LEAF_FAILURE_STATES);
const MISSING_STATES = new Set(["UNAVAIL", "CANT_OPEN"]);
const SUSPENDED = "SUSPENDED";
const LEAF_TYPES = new Set(["disk", "file"]);
const MIRROR_LIKE_TYPES = new Set(["mirror", "spare", "replacing"]);
const SPARE_CLASS = "spare";
const CACHE_CLASS = "l2cache";
const LOG_CLASS = "log";
const ALLOCATION_CLASSES = new Set(["special", "dedup"]);
const GUID_NUMBER = /"([a-zA-Z_]*guid[a-zA-Z_]*)":\s*(\d+)(?=[,}\s])/g;
const GUID_STRING = /"([a-zA-Z_]*guid[a-zA-Z_]*)":"(\d+)"/g;
const UINT64_MASK = (1n << 64n) - 1n;

export interface StatusMessage {
  status: string;
  action: string;
  msgid?: string;
}

/** `zpool status` texts from libzfs, in the order `check_status` tests for them. */
export const STATUS_MESSAGES = {
  ioFailure: {
    status: "One or more devices are faulted in response to IO failures.\n",
    action:
      "Make sure the affected devices are connected, then run 'zpool clear'.\n",
    msgid: "ZFS-8000-HC",
  },
  missingDevNoReplicas: {
    status:
      "One or more devices could not be opened.  There are insufficient\n\treplicas for the pool to continue functioning.\n",
    action: "Attach the missing device and online it using 'zpool online'.\n",
    msgid: "ZFS-8000-3C",
  },
  faultedDevNoReplicas: {
    status:
      "One or more devices are faulted in response to persistent errors.\n\tThere are insufficient replicas for the pool to continue functioning.\n",
    action:
      "Destroy and re-create the pool from a backup source.  Manually marking\n\tthe device repaired using 'zpool clear' may allow some data to be\n\trecovered.\n",
  },
  corruptData: {
    status:
      "One or more devices has experienced an error resulting in data\n\tcorruption.  Applications may be affected.\n",
    action:
      "Restore the file in question if possible.  Otherwise restore the\n\tentire pool from backup.\n",
    msgid: "ZFS-8000-8A",
  },
  faultedDev: {
    status:
      "One or more devices are faulted in response to persistent errors.\n\tSufficient replicas exist for the pool to continue functioning in a\n\tdegraded state.\n",
    action:
      "Replace the faulted device, or use 'zpool clear' to mark the device\n\trepaired.\n",
  },
  missingDev: {
    status:
      "One or more devices could not be opened.  Sufficient replicas exist for\n\tthe pool to continue functioning in a degraded state.\n",
    action: "Attach the missing device and online it using 'zpool online'.\n",
    msgid: "ZFS-8000-2Q",
  },
  failingDev: {
    status:
      "One or more devices has experienced an unrecoverable error.  An\n\tattempt was made to correct the error.  Applications are unaffected.\n",
    action:
      "Determine if the device needs to be replaced, and clear the errors\n\tusing 'zpool clear' or replace the device with 'zpool replace'.\n",
    msgid: "ZFS-8000-9P",
  },
  offlineDev: {
    status:
      "One or more devices has been taken offline by the administrator.\n\tSufficient replicas exist for the pool to continue functioning in a\n\tdegraded state.\n",
    action:
      "Online the device using 'zpool online' or replace the device with\n\t'zpool replace'.\n",
  },
  removedDev: {
    status:
      "One or more devices has been removed by the administrator.\n\tSufficient replicas exist for the pool to continue functioning in a\n\tdegraded state.\n",
    action:
      "Online the device using zpool online' or replace the device with\n\t'zpool replace'.\n",
  },
  resilvering: {
    status:
      "One or more devices is currently being resilvered.  The pool will\n\tcontinue to function, possibly in a degraded state.\n",
    action: "Wait for the resilver to complete.\n",
  },
} satisfies Record<string, StatusMessage>;

/** Texts for message ids no other fault kind covers, as `zpool status` prints them. */
export const UNCOVERED_STATUS_MESSAGES: Record<string, StatusMessage> = {
  "ZFS-8000-EY": {
    status:
      "Mismatch between pool hostid and system hostid on imported pool.\n\tThis pool was previously imported into a system with a different hostid,\n\tand then was verbatim imported into this system.\n",
    action:
      "Export this pool on all systems on which it is imported.\n\tThen import it to correct the mismatch.\n",
    msgid: "ZFS-8000-EY",
  },
  "ZFS-8000-K4": {
    status:
      "An intent log record could not be read.\n\tWaiting for administrator intervention to fix the faulted pool.\n",
    action:
      "Either restore the affected device(s) and run 'zpool online',\n\tor ignore the intent log records by running 'zpool clear'.\n",
    msgid: "ZFS-8000-K4",
  },
  "ZFS-8000-A5": {
    status: "The pool is formatted using an incompatible version.\n",
    action:
      "The pool cannot be accessed on this system.  Either move it to a\n\tsystem running a newer version of the software, or recreate the\n\tpool from backup.\n",
    msgid: "ZFS-8000-A5",
  },
};

const MOREINFO_BASE = "https://openzfs.github.io/openzfs-docs/msg/";

const KNOWN_STATUSES = new Set(
  Object.values(STATUS_MESSAGES).map((message) => message.status),
);

const KNOWN_MSGIDS = new Set(
  Object.values(STATUS_MESSAGES).flatMap((message: StatusMessage) =>
    message.msgid ? [message.msgid] : [],
  ),
);

export function parseZpoolJson(body: string): Json {
  return JSON.parse(body.replace(GUID_NUMBER, '"$1":"$2"')) as Json;
}

/** Prints guids bare again, as `--json-int` does. */
export function stringifyZpoolJson(json: Json): string {
  return `${JSON.stringify(json).replace(GUID_STRING, '"$1":$2')}\n`;
}

function poolsOf<T>(json: Json): Record<string, T> {
  return (json.pools ?? {}) as Record<string, T>;
}

export function hasPool(body: string, name: string): boolean {
  try {
    return name in poolsOf(parseZpoolJson(body));
  } catch {
    return false;
  }
}

export function statusPoolIn(body: string, name: string): StatusPool {
  const found = poolsOf<StatusPool>(parseZpoolJson(body))[name];
  if (!found) throw new Error(`No pool ${name} in zpool status`);
  return found;
}

function editPool<T>(
  stored: StoredPayload,
  name: string,
  edit: (pool: T) => void,
): StoredPayload {
  const json = parseZpoolJson(stored.body);
  const found = poolsOf<T>(json)[name];
  if (!found) throw new Error(`No pool ${name} in ${stored.source}`);
  edit(found);
  return { ...stored, body: stringifyZpoolJson(json) };
}

/** Returns a copy of the `zpool status -j` payload with one pool passed through `edit`, then its states and messages settled. */
export function editStatusPool(
  stored: StoredPayload,
  name: string,
  edit: (pool: StatusPool) => void,
): StoredPayload {
  return editPool<StatusPool>(stored, name, (found) => {
    edit(found);
    settle(found);
  });
}

export function editListPool(
  stored: StoredPayload,
  name: string,
  edit: (pool: ListPool) => void,
): StoredPayload {
  return editPool(stored, name, edit);
}

/** Returns a copy of the `zpool status -j` payload without the pool, as after a failed import or an export. */
export function withoutStatusPool(
  stored: StoredPayload,
  name: string,
): StoredPayload {
  const json = parseZpoolJson(stored.body);
  const pools = poolsOf<StatusPool>(json);
  if (!pools[name]) throw new Error(`No pool ${name} in ${stored.source}`);
  delete pools[name];
  return { ...stored, body: stringifyZpoolJson(json) };
}

const isLeaf = (vdev: StatusVdev) =>
  vdev.vdev_type === undefined || LEAF_TYPES.has(vdev.vdev_type);

/** A spare's flat entry is its aux status (`AVAIL`, `INUSE`, `UNAVAIL`), outside the vdev tree. */
const isSpareEntry = (vdev: StatusVdev) =>
  vdev.class === SPARE_CLASS && vdev.parent === undefined;

/** Cache devices and spares are aux devices: their state never reaches the root's. */
const isAux = (vdev: StatusVdev) =>
  vdev.class === CACHE_CLASS || isSpareEntry(vdev);

const stateOf = (vdev: StatusVdev) => vdev.state ?? "ONLINE";

const isUnhealthy = (vdev: StatusVdev) => UNHEALTHY_STATES.has(stateOf(vdev));

function rootOf(pool: StatusPool): StatusVdev | undefined {
  return Object.values(pool.vdevs).find((vdev) => vdev.vdev_type === "root");
}

function childrenOf(pool: StatusPool, parent: StatusVdev): StatusVdev[] {
  const all = Object.values(pool.vdevs);
  if (parent.vdev_type === "root") {
    return all.filter(
      (vdev) =>
        vdev !== parent &&
        !isAux(vdev) &&
        (vdev.parent === parent.name ||
          (vdev.parent === undefined && vdev.vdev_type !== "root")),
    );
  }
  const flat = all.filter((vdev) => vdev.parent === parent.name);
  // An in-use spare's in-pool copy lives only in the nested maps: its flat key
  // holds the aux entry.
  const nestedOnly = Object.entries(parent.vdevs ?? {})
    .filter(
      ([name, vdev]) =>
        vdev.parent === parent.name && pool.vdevs[name]?.parent !== parent.name,
    )
    .map(([, vdev]) => vdev);
  return [...flat, ...nestedOnly];
}

function topLevelOf(pool: StatusPool): StatusVdev[] {
  const root = rootOf(pool);
  if (root) return childrenOf(pool, root);
  return Object.values(pool.vdevs).filter(
    (vdev) =>
      !isAux(vdev) && (vdev.parent === undefined || vdev.parent === pool.name),
  );
}

const dataFirst = (a: StatusVdev, b: StatusVdev) =>
  Number((a.class ?? "normal") !== "normal") -
  Number((b.class ?? "normal") !== "normal");

/** Leaves of the pool, data vdevs first, then special, log and cache devices; spares' aux entries are not leaves. */
export function poolLeaves(pool: StatusPool): StatusVdev[] {
  return Object.values(pool.vdevs)
    .filter((vdev) => isLeaf(vdev) && !isSpareEntry(vdev))
    .sort(dataFirst);
}

export function cacheLeaves(pool: StatusPool): StatusVdev[] {
  return poolLeaves(pool).filter((vdev) => vdev.class === CACHE_CLASS);
}

/** Spares free to take over (`AVAIL`). */
export function poolSpares(pool: StatusPool): StatusVdev[] {
  return Object.values(pool.vdevs).filter(
    (vdev) => isSpareEntry(vdev) && stateOf(vdev) === "AVAIL",
  );
}

/** Group vdevs (mirror, raidz, …) below the root, data vdevs first. */
export function poolGroups(pool: StatusPool): StatusVdev[] {
  return Object.values(pool.vdevs)
    .filter((vdev) => !isLeaf(vdev) && vdev.vdev_type !== "root")
    .sort(dataFirst);
}

/** Mirrors of a special or dedup class: losing one of those loses the pool. */
export function allocationClassMirrors(pool: StatusPool): StatusVdev[] {
  return poolGroups(pool).filter(
    (vdev) =>
      ALLOCATION_CLASSES.has(vdev.class ?? "") &&
      vdev.vdev_type === "mirror" &&
      childrenOf(pool, vdev).length > 1,
  );
}

export function leafLabel(vdev: StatusVdev): string {
  return vdev.name.replace(/^\/dev\/(disk\/by-[a-z-]+\/)?/, "");
}

function vdevNamed(pool: StatusPool, name: string): StatusVdev {
  const found = pool.vdevs[name];
  if (!found) throw new Error(`No vdev ${name} in pool ${pool.name}`);
  return found;
}

function leafNamed(pool: StatusPool, name: string): StatusVdev {
  const found = pool.vdevs[name];
  if (!found || !isLeaf(found) || isSpareEntry(found)) {
    throw new Error(`No leaf ${name} in pool ${pool.name}`);
  }
  return found;
}

function groupNamed(pool: StatusPool, name: string): StatusVdev {
  const found = vdevNamed(pool, name);
  if (isLeaf(found) || found.vdev_type === "root") {
    throw new Error(`No group vdev ${name} in pool ${pool.name}`);
  }
  return found;
}

function redundancy(vdev: StatusVdev, children: StatusVdev[]): number {
  if (MIRROR_LIKE_TYPES.has(vdev.vdev_type ?? "")) {
    return Math.max(0, children.length - 1);
  }
  if (vdev.vdev_type === "raidz") {
    return Number(/^raidz([123])/.exec(vdev.name)?.[1] ?? 1);
  }
  return 0;
}

function groupState(vdev: StatusVdev, children: StatusVdev[]): string {
  const isRoot = vdev.vdev_type === "root";
  // A failed log device only degrades the pool: the intent log falls back to
  // the main pool.
  const failed = children.filter(
    (child) => isUnhealthy(child) && !(isRoot && child.class === LOG_CLASS),
  ).length;
  const limit = isRoot ? 0 : redundancy(vdev, children);
  if (failed > limit) return "UNAVAIL";
  return children.some((child) => stateOf(child) !== "ONLINE")
    ? "DEGRADED"
    : "ONLINE";
}

function settleVdev(pool: StatusPool, vdev: StatusVdev): string {
  if (isLeaf(vdev)) return stateOf(vdev);
  const children = childrenOf(pool, vdev);
  for (const child of children) settleVdev(pool, child);
  vdev.state = groupState(vdev, children);
  return vdev.state;
}

function rootState(pool: StatusPool): string {
  const root = rootOf(pool);
  if (root) return settleVdev(pool, root);
  const topLevel = topLevelOf(pool);
  for (const vdev of topLevel) settleVdev(pool, vdev);
  return groupState({ name: pool.name, vdev_type: "root" }, topLevel);
}

const hasErrors = (vdev: StatusVdev) =>
  Number(vdev.read_errors ?? 0) +
    Number(vdev.write_errors ?? 0) +
    Number(vdev.checksum_errors ?? 0) >
  0;

function statusMessage(pool: StatusPool, root: string): StatusMessage | null {
  const leaves = poolLeaves(pool);
  const anyLeaf = (predicate: (vdev: StatusVdev) => boolean) =>
    leaves.some(predicate);
  const inState = (...states: string[]) =>
    anyLeaf((vdev) => states.includes(stateOf(vdev)));
  if (pool.state === SUSPENDED) return STATUS_MESSAGES.ioFailure;
  if (root === "UNAVAIL") {
    return inState("FAULTED")
      ? STATUS_MESSAGES.faultedDevNoReplicas
      : STATUS_MESSAGES.missingDevNoReplicas;
  }
  if (Number(pool.error_count ?? 0) > 0) return STATUS_MESSAGES.corruptData;
  if (inState("FAULTED")) return STATUS_MESSAGES.faultedDev;
  if (anyLeaf((vdev) => MISSING_STATES.has(stateOf(vdev)))) {
    return STATUS_MESSAGES.missingDev;
  }
  if (anyLeaf(hasErrors)) return STATUS_MESSAGES.failingDev;
  if (inState("OFFLINE")) return STATUS_MESSAGES.offlineDev;
  if (inState("REMOVED")) return STATUS_MESSAGES.removedDev;
  const scan = pool.scan_stats;
  if (scan?.function === "RESILVER" && scan.state === "SCANNING") {
    return STATUS_MESSAGES.resilvering;
  }
  return null;
}

/** Sets the status and action texts, with the message id and its link when the message has one. */
export function showMessage(pool: StatusPool, message: StatusMessage) {
  pool.status = message.status;
  pool.action = message.action;
  if (message.msgid) {
    pool.msgid = message.msgid;
    pool.moreinfo = `${MOREINFO_BASE}${message.msgid}`;
  } else {
    delete pool.msgid;
    delete pool.moreinfo;
  }
}

function clearMessage(pool: StatusPool) {
  delete pool.status;
  delete pool.action;
  delete pool.msgid;
  delete pool.moreinfo;
}

// A message id the leaves cannot explain (hostid mismatch, bad log, …) keeps
// its message; simulated failures leave it in place.
const hasUnexplainedMessage = (pool: StatusPool) =>
  pool.msgid !== undefined && !KNOWN_MSGIDS.has(pool.msgid);

/** Recomputes group and pool states from the leaves the way ZFS does, and the status/action texts that follow. */
export function settle(pool: StatusPool) {
  const root = rootState(pool);
  if (pool.state !== SUSPENDED) pool.state = root;
  if (hasUnexplainedMessage(pool)) return;
  const message = statusMessage(pool, root);
  if (message) {
    showMessage(pool, message);
  } else if (pool.status !== undefined && KNOWN_STATUSES.has(pool.status)) {
    clearMessage(pool);
  }
}

export function failLeaf(
  pool: StatusPool,
  leafName: string,
  state: LeafFailureState,
) {
  leafNamed(pool, leafName).state = state;
}

interface ErrorCounts {
  read: number;
  write: number;
  checksum: number;
}

function setErrors(vdev: StatusVdev, errors: ErrorCounts) {
  Object.assign(vdev, {
    read_errors: errors.read,
    write_errors: errors.write,
    checksum_errors: errors.checksum,
  });
}

export function setLeafErrors(
  pool: StatusPool,
  leafName: string,
  errors: ErrorCounts,
) {
  setErrors(leafNamed(pool, leafName), errors);
}

/** Errors counted on a mirror or raidz itself: data it could not reconstruct. */
export function setGroupErrors(
  pool: StatusPool,
  groupName: string,
  errors: ErrorCounts,
) {
  setErrors(groupNamed(pool, groupName), errors);
}

export function setSlowIos(pool: StatusPool, leafName: string, count: number) {
  leafNamed(pool, leafName).slow_ios = count;
}

function descendantLeaves(pool: StatusPool, vdev: StatusVdev): StatusVdev[] {
  if (isLeaf(vdev)) return [vdev];
  return childrenOf(pool, vdev).flatMap((child) =>
    descendantLeaves(pool, child),
  );
}

/** Loses the first data vdev past its redundancy; failmode=wait suspends the pool. */
export function suspendPool(pool: StatusPool) {
  const first = topLevelOf(pool).sort(dataFirst)[0];
  if (!first) throw new Error(`Pool ${pool.name} has no vdevs`);
  const children = isLeaf(first) ? [first] : childrenOf(pool, first);
  const lost = descendantLeaves(pool, first)
    .filter((leaf) => !isUnhealthy(leaf))
    .slice(0, redundancy(first, children) + 1);
  for (const leaf of lost) {
    leaf.state = "UNAVAIL";
    leaf.read_errors = Number(leaf.read_errors ?? 0) + 3;
    leaf.write_errors = Number(leaf.write_errors ?? 0) + 6;
  }
  pool.state = SUSPENDED;
}

export function derivedGuid(seed: string): string {
  return (
    (BigInt(seed) * 6364136223846793005n + 1442695040888963407n) &
    UINT64_MASK
  ).toString();
}

function insertAfter<T>(
  map: Record<string, T>,
  key: string,
  entries: [string, T][],
): Record<string, T> {
  return Object.fromEntries(
    Object.entries(map).flatMap(([name, value]) =>
      name === key ? [[name, value], ...entries] : [[name, value]],
    ),
  );
}

function withoutKeys<T>(
  map: Record<string, T>,
  keys: Set<string>,
): Record<string, T> {
  return Object.fromEntries(
    Object.entries(map).filter(([name]) => !keys.has(name)),
  );
}

/** Nested `vdevs` maps mirror the flat map; point them at the edited entries, except where the flat key holds a spare's aux entry. */
function relink(pool: StatusPool) {
  for (const vdev of Object.values(pool.vdevs)) {
    if (!vdev.vdevs) continue;
    vdev.vdevs = Object.fromEntries(
      Object.entries(vdev.vdevs).map(([name, nested]) => {
        const flat = pool.vdevs[name];
        return [name, flat && !isSpareEntry(flat) ? flat : nested];
      }),
    );
  }
}

/**
 * A hot spare takes over for a failed leaf, as `zpool status -j --json-flat-vdevs` shows
 * it: both sit under a new `spare-N` vdev, the spare's in-pool copy only in the nested
 * maps, and its flat entry turns to aux `INUSE`.
 */
export function useSpare(
  pool: StatusPool,
  leafName: string,
  spareName: string,
  failedState: LeafFailureState = "FAULTED",
) {
  const leaf = leafNamed(pool, leafName);
  const aux = pool.vdevs[spareName];
  if (!aux || !isSpareEntry(aux) || stateOf(aux) !== "AVAIL") {
    throw new Error(`No available spare ${spareName} in pool ${pool.name}`);
  }
  const parent = leaf.parent ? pool.vdevs[leaf.parent] : rootOf(pool);
  const position = parent ? childrenOf(pool, parent).indexOf(leaf) : 0;
  const spareVdev: StatusVdev = {
    name: `spare-${position}`,
    vdev_type: "spare",
    guid: derivedGuid(aux.guid ?? leaf.guid ?? "1"),
    class: leaf.class ?? "normal",
    state: "DEGRADED",
    ...(leaf.parent !== undefined && { parent: leaf.parent }),
    read_errors: 0,
    write_errors: 0,
    checksum_errors: 0,
    vdevs: {},
  };
  const active: StatusVdev = {
    ...aux,
    state: "ONLINE",
    parent: spareVdev.name,
    read_errors: 0,
    write_errors: 0,
    checksum_errors: 0,
    slow_ios: 0,
  };
  leaf.state = failedState;
  leaf.parent = spareVdev.name;
  spareVdev.vdevs = { [leafName]: leaf, [spareName]: active };
  aux.state = "INUSE";
  aux.aux = "SPARED";

  pool.vdevs = insertAfter(pool.vdevs, leafName, [[spareVdev.name, spareVdev]]);
  for (const vdev of Object.values(pool.vdevs)) {
    if (vdev.vdevs && leafName in vdev.vdevs && vdev !== spareVdev) {
      vdev.vdevs = insertAfter(vdev.vdevs, leafName, [
        [spareName, active],
        [spareVdev.name, spareVdev],
      ]);
    }
  }
  relink(pool);
}

const SPACE_KEYS = ["alloc_space", "total_space", "def_space"] as const;

/** `zpool detach` every side of a mirror but the first: the survivor stands alone in the group's place. */
export function detachToSingle(pool: StatusPool, groupName: string) {
  const group = groupNamed(pool, groupName);
  const [kept, ...detached] = childrenOf(pool, group);
  if (!kept || !isLeaf(kept)) {
    throw new Error(`Vdev ${groupName} has no leaf to keep`);
  }
  if (group.parent === undefined) delete kept.parent;
  else kept.parent = group.parent;
  for (const key of SPACE_KEYS) {
    if (group[key] !== undefined) kept[key] = group[key];
  }
  const gone = new Set([groupName, ...detached.map((vdev) => vdev.name)]);
  pool.vdevs = withoutKeys(pool.vdevs, gone);
  for (const vdev of Object.values(pool.vdevs)) {
    if (vdev.vdevs) vdev.vdevs = withoutKeys(vdev.vdevs, gone);
  }
  relink(pool);
}

function allocatedBytes(pool: StatusPool): number {
  const root = rootOf(pool);
  if (root?.alloc_space !== undefined) return Number(root.alloc_space);
  return topLevelOf(pool).reduce(
    (sum, vdev) => sum + Number(vdev.alloc_space ?? 0),
    0,
  );
}

const epochSeconds = (date: Date) => Math.floor(date.getTime() / 1000);

const DEFAULT_SCRUB_SECONDS = 6 * 3600;
const RESILVER_BYTES_PER_SECOND = 400 * 1024 ** 2;

function lastScanSeconds(pool: StatusPool): number {
  const scan = pool.scan_stats;
  if (scan?.state === "FINISHED" && scan.end_time > scan.start_time) {
    return scan.end_time - scan.start_time;
  }
  return DEFAULT_SCRUB_SECONDS;
}

function scanStats(fields: {
  function: string;
  state: string;
  start: number;
  end: number;
  toExamine: number;
  examined: number;
  processed: number;
  errors: number;
}): ScanStats {
  return {
    function: fields.function,
    state: fields.state,
    start_time: fields.start,
    end_time: fields.end,
    to_examine: fields.toExamine,
    examined: fields.examined,
    skipped: 0,
    processed: fields.processed,
    errors: fields.errors,
    bytes_per_scan: 0,
    pass_start: fields.start,
    scrub_pause: 0,
    scrub_spent_paused: 0,
    issued_bytes_per_scan: 0,
    issued: fields.examined,
  };
}

export function finishScrub(
  pool: StatusPool,
  options: { endedAt: Date; errors: number; repairedBytes: number },
) {
  const end = epochSeconds(options.endedAt);
  const toExamine = pool.scan_stats?.to_examine || allocatedBytes(pool);
  pool.scan_stats = scanStats({
    function: "SCRUB",
    state: "FINISHED",
    start: end - lastScanSeconds(pool),
    end,
    toExamine,
    examined: toExamine,
    processed: options.repairedBytes,
    errors: options.errors,
  });
}

function damagedPaths(poolName: string, count: number): string[] {
  return Array.from(
    { length: count },
    (_, index) =>
      `/${poolName}/photos/${2019 + (index % 6)}/IMG_${4100 + index}.jpg`,
  );
}

/** `error_count`, and the damaged files `-v` lists as root; an unprivileged `errlist` string stays. */
export function setDataErrors(pool: StatusPool, count: number) {
  pool.error_count = count;
  if (count === 0) delete pool.errlist;
  else if (typeof pool.errlist !== "string") {
    pool.errlist = damagedPaths(pool.name, count);
  }
}

export type ScanFunction = "SCRUB" | "RESILVER";

/** A running scan `percent` through that last moved at `movedAt`; a paused one has been paused since then. */
export function runScan(
  pool: StatusPool,
  options: {
    function: ScanFunction;
    percent: number;
    movedAt: Date;
    paused?: boolean;
  },
) {
  const toExamine = allocatedBytes(pool);
  const examined = Math.round((toExamine * options.percent) / 100);
  const elapsed = Math.max(
    60,
    Math.round((lastScanSeconds(pool) * options.percent) / 100),
  );
  const movedAt = epochSeconds(options.movedAt);
  const leaves = Math.max(1, poolLeaves(pool).length);
  pool.scan_stats = {
    ...scanStats({
      function: options.function,
      state: "SCANNING",
      start: movedAt - elapsed,
      end: 0,
      toExamine,
      examined,
      processed:
        options.function === "RESILVER" ? Math.round(examined / leaves) : 0,
      errors: 0,
    }),
    scrub_pause: options.paused ? movedAt : 0,
  };
}

/** The leaf rejoins (if it had failed) and resilvers; the scan is `percent` through. */
export function startResilver(
  pool: StatusPool,
  leafName: string,
  percent: number,
  now: Date,
) {
  const leaf = leafNamed(pool, leafName);
  if (isUnhealthy(leaf)) leaf.state = "ONLINE";
  const toExamine = allocatedBytes(pool);
  const examined = Math.round((toExamine * percent) / 100);
  const elapsed = Math.max(
    60,
    Math.round(examined / RESILVER_BYTES_PER_SECOND),
  );
  const leaves = Math.max(1, poolLeaves(pool).length);
  pool.scan_stats = scanStats({
    function: "RESILVER",
    state: "SCANNING",
    start: epochSeconds(now) - elapsed,
    end: 0,
    toExamine,
    examined,
    processed: Math.round(examined / leaves),
    errors: 0,
  });
}

/** zpool status `alloc_space` for the root and data vdevs at `percent` full. */
export function setStatusCapacity(pool: StatusPool, percent: number) {
  const root = rootOf(pool);
  const data = topLevelOf(pool).filter(
    (vdev) => (vdev.class ?? "normal") === "normal",
  );
  for (const vdev of [...(root ? [root] : []), ...data]) {
    if (typeof vdev.total_space === "number") {
      vdev.alloc_space = Math.round((vdev.total_space * percent) / 100);
    }
  }
}

function dataListEntries(pool: ListPool): ListEntry[] {
  return Object.values(pool.vdevs ?? {}).filter(
    (entry): entry is ListEntry =>
      "properties" in entry && (entry.class ?? "normal") === "normal",
  );
}

function setNumeric(entry: ListEntry, key: string, value: number) {
  const current = entry.properties[key];
  if (current) entry.properties[key] = { ...current, value };
}

const hasNumericSize = (entry: ListEntry) =>
  typeof entry.properties.size?.value === "number";

/** zpool list size/allocated/free/capacity for the pool and its data vdevs at `percent` full. */
export function setListCapacity(pool: ListPool, percent: number) {
  for (const entry of [pool, ...dataListEntries(pool)]) {
    if (!hasNumericSize(entry)) continue;
    const size = entry.properties.size?.value as number;
    const allocated = Math.round((size * percent) / 100);
    setNumeric(entry, "allocated", allocated);
    setNumeric(entry, "free", size - allocated);
    setNumeric(entry, "capacity", percent);
  }
}

export function setListFragmentation(pool: ListPool, percent: number) {
  for (const entry of [pool, ...dataListEntries(pool)]) {
    if (hasNumericSize(entry)) setNumeric(entry, "fragmentation", percent);
  }
}

// zpool events -vH

export const EREPORT_CLASSES = [
  "ereport.fs.zfs.checksum",
  "ereport.fs.zfs.io",
  "ereport.fs.zfs.data",
] as const;
export type EreportClass = (typeof EREPORT_CLASSES)[number];

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

const hex = (decimal: string | number | bigint) =>
  `0x${BigInt(decimal).toString(16)}`;
const quoted = (value: string) => `"${value}"`;
const pad = (value: number, width = 2) => String(value).padStart(width, "0");

export function newestEid(body: string): number {
  let newest = 0;
  for (const match of body.matchAll(/^\s+eid = (0x[0-9a-f]+)\s*$/gim)) {
    newest = Math.max(newest, Number(match[1]));
  }
  return newest;
}

export interface EreportLeaf {
  guid: string;
  path?: string;
  devid?: string;
  physPath?: string;
  parentGuid: string;
  parentType: string;
}

export function ereportLeaf(pool: StatusPool, leafName: string): EreportLeaf {
  const leaf = leafNamed(pool, leafName);
  const parent = leaf.parent ? pool.vdevs[leaf.parent] : rootOf(pool);
  return {
    guid: leaf.guid ?? derivedGuid(pool.pool_guid ?? "1"),
    path: leaf.path,
    devid: leaf.devid,
    physPath: leaf.phys_path,
    parentGuid: parent?.guid ?? pool.pool_guid ?? "0",
    parentType: parent?.vdev_type ?? "root",
  };
}

interface Ereport {
  eventClass: EreportClass;
  pool: { name: string; guid: string };
  leaf: EreportLeaf;
  eid: number;
  seconds: number;
  nanoseconds: number;
}

function headerTimestamp(seconds: number, nanoseconds: number) {
  const at = new Date(seconds * 1000);
  return `${MONTHS[at.getUTCMonth()]} ${pad(at.getUTCDate())} ${at.getUTCFullYear()} ${pad(at.getUTCHours())}:${pad(at.getUTCMinutes())}:${pad(at.getUTCSeconds())}.${pad(nanoseconds, 9)}`;
}

function vdevFields(leaf: EreportLeaf, index: number): [string, string][] {
  const isOptional = (field: [string, string | undefined]) =>
    field[1] !== undefined;
  return [
    ["vdev_guid", hex(leaf.guid)],
    ["vdev_type", quoted("disk")],
    ...(
      [
        ["vdev_path", leaf.path && quoted(leaf.path)],
        ["vdev_devid", leaf.devid && quoted(leaf.devid)],
        ["vdev_physpath", leaf.physPath && quoted(leaf.physPath)],
      ] as [string, string | undefined][]
    ).filter(isOptional),
    ["vdev_ashift", "0xc"],
    ["vdev_delta_ts", hex(40_000 + index * 977)],
    ["vdev_delays", "0x0"],
    ["parent_guid", hex(leaf.parentGuid)],
    ["parent_type", quoted(leaf.parentType)],
  ] as [string, string][];
}

function ereportBlock(report: Ereport, index: number): string {
  const isChecksum = report.eventClass === "ereport.fs.zfs.checksum";
  const isIo = report.eventClass === "ereport.fs.zfs.io";
  const fields: [string, string][] = [
    ["class", quoted(report.eventClass)],
    ["ena", hex(BigInt(report.seconds) * 1_000_000_000n + BigInt(index))],
    ["pool", quoted(report.pool.name)],
    ["pool_guid", hex(report.pool.guid)],
    ["pool_state", "0x0"],
    ["pool_context", "0x0"],
    ["pool_failmode", quoted("wait")],
    ...(report.eventClass === "ereport.fs.zfs.data"
      ? []
      : vdevFields(report.leaf, index)),
    ["zio_err", isIo ? "0x5" : "0x34"],
    ["zio_flags", isIo ? "0x180880" : "0x100080"],
    ["zio_stage", isIo ? "0x200000" : "0x400000"],
    ["zio_priority", "0x4"],
    ["zio_offset", hex((index + 1) * 2 ** 22)],
    ["zio_size", hex(isIo ? 0x1000 : 0x20000)],
    ["zio_objset", hex(0x36 + index)],
    ["zio_object", hex(0x2000 + index * 7)],
    ["zio_level", "0x0"],
    ["zio_blkid", hex(index)],
    ...(isChecksum
      ? ([["cksum_algorithm", quoted("fletcher4")]] as [string, string][])
      : []),
    ["time", `${hex(report.seconds)} ${hex(report.nanoseconds)} `],
    ["eid", hex(report.eid)],
  ];
  return [
    `${headerTimestamp(report.seconds, report.nanoseconds)}\t${report.eventClass}`,
    ...fields.map(([key, value]) => `        ${key} = ${value}`),
    "",
  ].join("\n");
}

/** Appends `count` ereports at `at`, numbered on from `afterEid` (default: the newest in the body). */
export function appendEreports(
  body: string,
  options: {
    eventClass: EreportClass;
    pool: { name: string; guid: string };
    leaf: EreportLeaf;
    count: number;
    at: Date;
    afterEid?: number;
  },
): string {
  const first = Math.max(newestEid(body), options.afterEid ?? 0) + 1;
  const seconds = epochSeconds(options.at);
  const baseNanos = (options.at.getTime() % 1000) * 1_000_000;
  const blocks = Array.from({ length: options.count }, (_, index) =>
    ereportBlock(
      {
        eventClass: options.eventClass,
        pool: options.pool,
        leaf: options.leaf,
        eid: first + index,
        seconds,
        nanoseconds: baseNanos + index * 1000,
      },
      index,
    ),
  );
  const trimmed = body.replace(/\n*$/, "");
  return `${trimmed === "" ? "" : `${trimmed}\n\n`}${blocks.join("\n")}\n`;
}
