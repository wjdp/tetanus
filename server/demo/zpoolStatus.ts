import type {
  HostModel,
  LeafAt,
  PoolModel,
  ScanState,
  VdevClass,
  VdevModel,
} from "./types";
import type { DemoWorld } from "./world";
import {
  bigInt,
  DEFAULT_SOURCE,
  epochSeconds,
  groupGuid,
  groupName,
  hostPoolsAt,
  jsonWithBigInts,
  leafDevid,
  leafGuid,
  leafListName,
  leafPath,
  leafPhysPath,
  leafPhysSpace,
  leafRepDevSize,
  property,
  replacingGuid,
  replacingName,
  txgAt,
} from "./zfsCommon";

interface Space {
  total: number;
  alloc: number;
  deflated: number;
  frag: number;
}

interface TopologyNode {
  name: string;
  listName: string;
  guid: string;
  vdevType: "root" | "raidz" | "mirror" | "replacing" | "disk";
  class: VdevClass;
  state: string;
  /** Status `parent` key; class groups (special) and the root print none. */
  parent: string | null;
  leaf?: LeafAt;
  space?: Space;
  children: TopologyNode[];
}

export interface PoolTopology {
  pool: PoolModel;
  root: TopologyNode;
  /** Top-level vdevs of a non-normal allocation class, printed outside the root. */
  classGroups: TopologyNode[];
  spares: TopologyNode[];
  space: Space;
}

const OUTPUT_VERSION = (command: string) => ({
  command,
  vers_major: 0,
  vers_minor: 1,
});

const SPECIAL_SHARE_OF_FILL = 0.55;

function parityOf(vdev: VdevModel) {
  if (vdev.type === "raidz1") return 1;
  if (vdev.type === "raidz2") return 2;
  return 0;
}

function fragmentation(allocFraction: number) {
  return Math.round(3 + 34 * allocFraction ** 1.6);
}

function vdevSpace(
  vdev: VdevModel,
  leaves: LeafAt[],
  allocFraction: number,
): Space {
  const smallest = Math.min(...leaves.map((leaf) => leaf.disk.capacityBytes));
  const members = vdev.type === "mirror" ? 1 : vdev.width;
  const total = smallest * members;
  const deflated = Math.round(
    (total * (vdev.width - parityOf(vdev))) / vdev.width,
  );
  const alloc = Math.round(total * allocFraction);
  return {
    total,
    alloc,
    deflated: vdev.type === "mirror" ? total : deflated,
    frag: fragmentation(allocFraction),
  };
}

function leafNode(
  host: HostModel,
  pool: PoolModel,
  leaf: LeafAt,
  parent: string | null,
): TopologyNode {
  return {
    name: leafPath(host, leaf.disk),
    listName: leafListName(host, leaf.disk),
    guid: leafGuid(pool, leaf.disk),
    vdevType: "disk",
    class: leaf.vdev.class,
    state:
      leaf.vdev.class === "spare" ? (leaf.spareStatus ?? "AVAIL") : leaf.state,
    parent,
    leaf,
    children: [],
  };
}

const degradedIfAny = (children: TopologyNode[]) =>
  children.some((child) => child.state !== "ONLINE") ? "DEGRADED" : "ONLINE";

function slotNodes(
  host: HostModel,
  pool: PoolModel,
  leaves: LeafAt[],
  parent: string,
): TopologyNode[] {
  const positions = [...new Set(leaves.map((leaf) => leaf.position))];
  return positions.map((position) => {
    const slot = leaves.filter((leaf) => leaf.position === position);
    const first = slot[0] as LeafAt;
    if (slot.length === 1) return leafNode(host, pool, first, parent);
    const incoming = slot.find((leaf) => leaf.resilvering) ?? first;
    const name = replacingName(first);
    const children = slot.map((leaf) => leafNode(host, pool, leaf, name));
    return {
      name,
      listName: name,
      guid: replacingGuid(pool, incoming.disk),
      vdevType: "replacing",
      class: first.vdev.class,
      state: degradedIfAny(children),
      parent,
      children,
    };
  });
}

export function poolTopology(
  world: DemoWorld,
  host: HostModel,
  pool: PoolModel,
  t: Date,
): PoolTopology {
  const { stories } = world;
  const leaves = stories.leavesAt(pool, t);
  const size = stories.poolSizeBytes(pool, t);
  const allocated = stories.allocatedBytes(pool, t);
  const fill = size > 0 ? allocated / size : 0;
  const active = pool.vdevs
    .filter((vdev) => vdev.class !== "spare")
    .map((vdev) => ({
      vdev,
      leaves: leaves.filter((leaf) => leaf.vdev === vdev),
    }))
    .filter(({ leaves: members }) => members.length > 0);

  const specialFill = fill * SPECIAL_SHARE_OF_FILL;
  const rawSpecial = active
    .filter(({ vdev }) => vdev.class === "special")
    .map(({ vdev, leaves: members }) => vdevSpace(vdev, members, specialFill));
  const specialAlloc = rawSpecial.reduce((sum, space) => sum + space.alloc, 0);
  const normalTotal = active
    .filter(({ vdev }) => vdev.class === "normal")
    .reduce(
      (sum, { vdev, leaves: members }) =>
        sum + vdevSpace(vdev, members, 0).total,
      0,
    );
  const normalFill =
    normalTotal > 0 ? (allocated - specialAlloc) / normalTotal : 0;

  const topLevel = active.map(({ vdev, leaves: members }): TopologyNode => {
    const isClass = vdev.class !== "normal";
    const space = vdevSpace(vdev, members, isClass ? specialFill : normalFill);
    if (vdev.type === "disk") {
      const [only] = slotNodes(host, pool, members, pool.name);
      return { ...(only as TopologyNode), space };
    }
    const name = groupName(vdev);
    const children = slotNodes(host, pool, members, name);
    return {
      name,
      listName: name,
      guid: groupGuid(pool, vdev),
      vdevType: vdev.type === "mirror" ? "mirror" : "raidz",
      class: vdev.class,
      state: degradedIfAny(children),
      parent: isClass ? null : pool.name,
      space,
      children,
    };
  });

  const normal = topLevel.filter((node) => node.class === "normal");
  const space: Space = {
    total: size,
    alloc: allocated,
    deflated: topLevel.reduce(
      (total, node) => total + (node.space?.deflated ?? 0),
      0,
    ),
    frag: fragmentation(fill),
  };
  return {
    pool,
    root: {
      name: pool.name,
      listName: pool.name,
      guid: pool.guid,
      vdevType: "root",
      class: "normal",
      state: stories.poolState(pool, t),
      parent: null,
      space,
      children: normal,
    },
    classGroups: topLevel.filter((node) => node.class !== "normal"),
    spares: leaves
      .filter((leaf) => leaf.vdev.class === "spare")
      .map((leaf) => leafNode(host, pool, leaf, null)),
    space,
  };
}

// zpool status -j --json-flat-vdevs --json-int -Ppvs

function statusLeaf(node: TopologyNode) {
  const leaf = node.leaf as LeafAt;
  return {
    name: node.name,
    vdev_type: "disk",
    guid: bigInt(node.guid),
    path: node.name,
    phys_path: leafPhysPath(leaf.disk),
    devid: leafDevid(leaf.disk),
    class: node.class,
    state: node.state,
    ...(node.parent !== null && { parent: node.parent }),
    rep_dev_size: leafRepDevSize(leaf.disk),
    phys_space: leafPhysSpace(leaf.disk),
    read_errors: leaf.errors.read,
    write_errors: leaf.errors.write,
    checksum_errors: leaf.errors.checksum,
    slow_ios: 0,
  };
}

type StatusEntry = Record<string, unknown>;

function statusEntries(node: TopologyNode): [string, StatusEntry][] {
  if (node.vdevType === "disk") return [[node.name, statusLeaf(node)]];
  const descendants = node.children.flatMap(statusEntries);
  const space = node.space;
  const entry: StatusEntry = {
    name: node.name,
    vdev_type: node.vdevType,
    guid: bigInt(node.guid),
    class: node.class,
    state: node.state,
    ...(node.parent !== null && { parent: node.parent }),
    ...(space && {
      alloc_space: space.alloc,
      total_space: space.total,
      def_space: space.deflated,
    }),
    ...(space && node.vdevType !== "root" && { rep_dev_size: space.total }),
    read_errors: 0,
    write_errors: 0,
    checksum_errors: 0,
    vdevs: Object.fromEntries(descendants),
  };
  return [...descendants, [node.name, entry]];
}

const STATUS_MESSAGES = {
  resilvering: {
    status:
      "One or more devices is currently being resilvered.  The pool will\n\tcontinue to function, possibly in a degraded state.\n",
    action: "Wait for the resilver to complete.\n",
  },
  faulted: {
    status:
      "One or more devices are faulted in response to persistent errors.\n\tSufficient replicas exist for the pool to continue functioning in a\n\tdegraded state.\n",
    action:
      "Replace the faulted device, or use 'zpool clear' to mark the device\n\trepaired.\n",
  },
  errors: {
    status:
      "One or more devices has experienced an unrecoverable error.  An\n\tattempt was made to correct the error.  Applications are unaffected.\n",
    action:
      "Determine if the device needs to be replaced, and clear the errors\n\tusing 'zpool clear' or replace the device with 'zpool replace'.\n",
  },
};

function statusMessage(leaves: LeafAt[], scan: ScanState | null) {
  const active = leaves.filter((leaf) => leaf.vdev.class !== "spare");
  if (scan?.function === "RESILVER" && scan.state === "SCANNING") {
    return STATUS_MESSAGES.resilvering;
  }
  if (active.some((leaf) => leaf.state !== "ONLINE")) {
    return STATUS_MESSAGES.faulted;
  }
  const hasErrors = active.some(
    (leaf) => leaf.errors.read + leaf.errors.write + leaf.errors.checksum > 0,
  );
  return hasErrors ? STATUS_MESSAGES.errors : null;
}

function scanStats(scan: ScanState, bootedAt: Date) {
  const passStart =
    scan.startTime.getTime() > bootedAt.getTime() ? scan.startTime : bootedAt;
  return {
    function: scan.function,
    state: scan.state,
    start_time: epochSeconds(scan.startTime),
    end_time: scan.endTime ? epochSeconds(scan.endTime) : 0,
    to_examine: scan.toExamine,
    examined: scan.examined,
    skipped: 0,
    processed: scan.processed,
    errors: scan.errors,
    bytes_per_scan: 0,
    pass_start: epochSeconds(passStart),
    scrub_pause: 0,
    scrub_spent_paused: 0,
    issued_bytes_per_scan: 0,
    issued: Math.floor(scan.examined * 0.9998),
  };
}

function statusPool(world: DemoWorld, topology: PoolTopology, t: Date) {
  const { pool } = topology;
  const scan = world.stories.scanState(pool, t);
  const leaves = world.stories.leavesAt(pool, t);
  const message = statusMessage(leaves, scan);
  const vdevs = [
    ...statusEntries(topology.root),
    ...topology.classGroups.flatMap(statusEntries),
  ];
  return {
    name: pool.name,
    state: topology.root.state,
    pool_guid: bigInt(pool.guid),
    txg: txgAt(pool, t),
    spa_version: 5000,
    zpl_version: 5,
    ...message,
    ...(scan && {
      scan_stats: scanStats(scan, world.stories.lastBoot(pool.host, t)),
    }),
    vdevs: Object.fromEntries(vdevs),
    ...(topology.spares.length > 0 && {
      spares: Object.fromEntries(
        topology.spares.map((node) => [node.name, statusLeaf(node)]),
      ),
    }),
    error_count: 0,
  };
}

export function renderZpoolStatus(
  world: DemoWorld,
  host: HostModel,
  t: Date,
): string {
  const pools = hostPoolsAt(world, host, t).map((pool) =>
    statusPool(world, poolTopology(world, host, pool, t), t),
  );
  return jsonWithBigInts({
    output_version: OUTPUT_VERSION("zpool status"),
    pools: Object.fromEntries(pools.map((pool) => [pool.name, pool])),
  });
}

// zpool list -j --json-int -pv

const UNSET = "-";

function listProperties(space: Space | null, health: string, isPool = false) {
  const free = space ? space.total - space.alloc : UNSET;
  const capacity = space
    ? Math.floor((space.alloc / Math.max(1, space.total)) * 100)
    : UNSET;
  return {
    size: property(space?.total ?? UNSET),
    allocated: property(space?.alloc ?? UNSET),
    free: property(free),
    checkpoint: property(UNSET),
    expandsize: property(UNSET),
    fragmentation: property(space?.frag ?? UNSET),
    capacity: property(capacity),
    dedupratio: property(isPool ? "1.00" : UNSET),
    health: property(health),
    altroot: property(UNSET, isPool ? DEFAULT_SOURCE : undefined),
  };
}

type ListEntry = Record<string, unknown>;

function listLeaf(node: TopologyNode): ListEntry {
  const leaf = node.leaf as LeafAt;
  return {
    name: node.listName,
    vdev_type: "disk",
    guid: bigInt(node.guid),
    path: node.name,
    phys_path: leafPhysPath(leaf.disk),
    devid: leafDevid(leaf.disk),
    class: node.class,
    state: node.state,
    properties: {
      ...listProperties(null, node.state),
      size: property(leafPhysSpace(leaf.disk)),
    },
  };
}

function listEntry(node: TopologyNode): ListEntry {
  if (node.vdevType === "disk") {
    const entry = listLeaf(node);
    return node.space
      ? { ...entry, properties: listProperties(node.space, node.state) }
      : entry;
  }
  return {
    name: node.listName,
    vdev_type: node.vdevType,
    guid: bigInt(node.guid),
    class: node.class,
    state: node.state,
    properties: listProperties(node.space ?? null, node.state),
    vdevs: Object.fromEntries(
      node.children.map((child) => [child.listName, listEntry(child)]),
    ),
  };
}

function listPool(topology: PoolTopology, t: Date) {
  const { pool, root } = topology;
  const byClass = new Map<VdevClass, TopologyNode[]>();
  for (const node of topology.classGroups) {
    byClass.set(node.class, [...(byClass.get(node.class) ?? []), node]);
  }
  const classEntries = [...byClass].map(([vdevClass, nodes]) => [
    vdevClass,
    Object.fromEntries(nodes.map((node) => [node.listName, listEntry(node)])),
  ]);
  return {
    name: pool.name,
    type: "POOL",
    state: root.state,
    pool_guid: bigInt(pool.guid),
    txg: txgAt(pool, t),
    spa_version: 5000,
    zpl_version: 5,
    properties: listProperties(topology.space, root.state, true),
    vdevs: Object.fromEntries([
      ...root.children.map((node) => [node.listName, listEntry(node)]),
      ...classEntries,
      ...(topology.spares.length > 0
        ? [
            [
              "spares",
              Object.fromEntries(
                topology.spares.map((node) => [node.listName, listLeaf(node)]),
              ),
            ],
          ]
        : []),
    ]),
  };
}

export function renderZpoolList(
  world: DemoWorld,
  host: HostModel,
  t: Date,
): string {
  const pools = hostPoolsAt(world, host, t).map((pool) =>
    listPool(poolTopology(world, host, pool, t), t),
  );
  return jsonWithBigInts({
    output_version: OUTPUT_VERSION("zpool list"),
    pools: Object.fromEntries(pools.map((pool) => [pool.name, pool])),
  });
}
