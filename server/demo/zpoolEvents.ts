import { forkRng } from "./prng";
import type { HostModel, LeafAt, PoolModel, ZpoolEvent } from "./types";
import type { DemoWorld } from "./world";
import {
  groupGuid,
  hexOf,
  hostPoolsAt,
  leafDevid,
  leafGuid,
  leafPath,
  leafPhysPath,
  replacingGuid,
} from "./zfsCommon";

/** `zfs_zevent_len_max`: the kernel keeps only the newest events. */
export const ZEVENT_RING_LENGTH = 512;

const BOOT_IMPORT_DELAY_MS = 25_000;

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

const VDEV_STATE_CODES: Record<string, number> = {
  REMOVED: 3,
  UNAVAIL: 4,
  FAULTED: 5,
  DEGRADED: 6,
  ONLINE: 7,
};

const LAST_STATE: Record<string, string> = {
  FAULTED: "ONLINE",
  UNAVAIL: "REMOVED",
};

const ms = (date: Date) => date.getTime();
const pad = (value: number, width = 2) => String(value).padStart(width, "0");

interface EventSpec {
  at: Date;
  class: string;
  pool: PoolModel;
  vdevAlias?: string;
  vdevState?: string;
}

type Field = [key: string, value: string];

const quoted = (value: string) => `"${value}"`;
const stateValue = (state: string) =>
  `"${state}" (${hexOf(VDEV_STATE_CODES[state] ?? 0)})`;

interface LeafInfo {
  guid: string;
  path: string;
  devid: string;
  physPath: string;
  parentGuid: string;
  parentType: string;
  errors: LeafAt["errors"];
}

function leafInfo(
  world: DemoWorld,
  host: HostModel,
  pool: PoolModel,
  alias: string,
  at: Date,
): LeafInfo {
  const leaves = world.stories.leavesAt(pool, at);
  const leaf = leaves.find((candidate) => candidate.disk.alias === alias);
  const disk = leaf?.disk ?? world.stories.disk(alias);
  const parent = (): { guid: string; type: string } => {
    if (!leaf || leaf.vdev.class === "spare")
      return { guid: pool.guid, type: "root" };
    if (leaf.replacing) {
      const incoming =
        leaves.find(
          (candidate) =>
            candidate.vdev === leaf.vdev &&
            candidate.position === leaf.position &&
            candidate.resilvering,
        ) ?? leaf;
      return { guid: replacingGuid(pool, incoming.disk), type: "replacing" };
    }
    if (leaf.vdev.type === "disk") return { guid: pool.guid, type: "root" };
    return {
      guid: groupGuid(pool, leaf.vdev),
      type: leaf.vdev.type === "mirror" ? "mirror" : "raidz",
    };
  };
  const { guid: parentGuid, type: parentType } = parent();
  return {
    guid: leafGuid(pool, disk),
    path: leafPath(host, disk),
    devid: leafDevid(disk),
    physPath: leafPhysPath(disk),
    parentGuid,
    parentType,
    errors: leaf?.errors ?? { read: 0, write: 0, checksum: 0 },
  };
}

function poolFields(pool: PoolModel): Field[] {
  return [
    ["pool", quoted(pool.name)],
    ["pool_guid", hexOf(pool.guid)],
    ["pool_state", "0x0"],
    ["pool_context", "0x0"],
  ];
}

function ereportFields(spec: EventSpec, leaf: LeafInfo, seed: string): Field[] {
  const rng = forkRng(`ereport:${seed}`);
  const isChecksum = spec.class === "ereport.fs.zfs.checksum";
  const completeTs = BigInt(rng.int(1, 2 ** 30)) * 1_000_000n;
  return [
    ["class", quoted(spec.class)],
    ["ena", `0x${rng.hex(15)}1`],
    ["detector", "(embedded nvlist)"],
    ["  version", "0x0"],
    ["  scheme", quoted("zfs")],
    ["  pool", hexOf(spec.pool.guid)],
    ["  vdev", hexOf(leaf.guid)],
    ["(end detector)", ""],
    ...poolFields(spec.pool),
    ["pool_failmode", quoted("wait")],
    ["vdev_guid", hexOf(leaf.guid)],
    ["vdev_type", quoted("disk")],
    ["vdev_path", quoted(leaf.path)],
    ["vdev_devid", quoted(leaf.devid)],
    ["vdev_physpath", quoted(leaf.physPath)],
    ["vdev_ashift", hexOf(spec.pool.ashift)],
    ["vdev_complete_ts", hexOf(completeTs.toString())],
    ["vdev_delta_ts", hexOf(rng.int(20_000, 900_000))],
    ["vdev_read_errors", hexOf(leaf.errors.read)],
    ["vdev_write_errors", hexOf(leaf.errors.write)],
    ["vdev_cksum_errors", hexOf(leaf.errors.checksum)],
    ["vdev_delays", "0x0"],
    ["parent_guid", hexOf(leaf.parentGuid)],
    ["parent_type", quoted(leaf.parentType)],
    ["vdev_spare_paths", ""],
    ["vdev_spare_guids", ""],
    ["zio_err", isChecksum ? "0x34" : "0x5"],
    ["zio_flags", isChecksum ? "0x100080" : "0x180880"],
    ["zio_stage", isChecksum ? "0x400000" : "0x200000"],
    ["zio_pipeline", isChecksum ? "0x3e00000" : "0x2e00000"],
    ["zio_delay", "0x0"],
    ["zio_timestamp", "0x0"],
    ["zio_delta", "0x0"],
    ["zio_priority", "0x4"],
    ["zio_offset", hexOf(rng.int(1, 2 ** 20) * 2 ** 22)],
    ["zio_size", hexOf(isChecksum ? 0x20000 : 0x1000)],
    ["zio_objset", hexOf(rng.int(0x40, 0x9000))],
    ["zio_object", hexOf(rng.int(0x2, 0x80000))],
    ["zio_level", "0x0"],
    ["zio_blkid", hexOf(rng.int(0, 0x4000))],
    ...(isChecksum
      ? ([["cksum_algorithm", quoted("fletcher4")]] as Field[])
      : []),
  ];
}

function eventFields(
  world: DemoWorld,
  host: HostModel,
  spec: EventSpec,
  seed: string,
): Field[] {
  const leaf = spec.vdevAlias
    ? leafInfo(world, host, spec.pool, spec.vdevAlias, spec.at)
    : null;
  if (spec.class.startsWith("ereport.") && leaf) {
    return ereportFields(spec, leaf, seed);
  }
  const head: Field[] = [
    ["version", "0x0"],
    ["class", quoted(spec.class)],
    ...poolFields(spec.pool),
  ];
  if (spec.class === "resource.fs.zfs.statechange" && leaf) {
    const state = spec.vdevState ?? "ONLINE";
    return [
      ...head,
      ["vdev_guid", hexOf(leaf.guid)],
      ["vdev_state", stateValue(state)],
      ["vdev_path", quoted(leaf.path)],
      ["vdev_devid", quoted(leaf.devid)],
      ["vdev_physpath", quoted(leaf.physPath)],
      ["vdev_laststate", stateValue(LAST_STATE[state] ?? "ONLINE")],
    ];
  }
  if (spec.class === "resource.fs.zfs.removed" && leaf) {
    return [
      ...head,
      ["vdev_guid", hexOf(leaf.guid)],
      ["vdev_state", stateValue("REMOVED")],
      ["vdev_path", quoted(leaf.path)],
      ["vdev_devid", quoted(leaf.devid)],
    ];
  }
  if (spec.class === "sysevent.fs.zfs.vdev_attach" && leaf) {
    return [
      ...head,
      ["vdev_guid", hexOf(leaf.guid)],
      ["vdev_path", quoted(leaf.path)],
      ["vdev_devid", quoted(leaf.devid)],
    ];
  }
  if (spec.class.startsWith("sysevent.fs.zfs.resilver_")) {
    return [...head, ["resilver_type", quoted("healing")]];
  }
  return head;
}

/** OpenZFS leaves the eid off a `removed` event paired with its statechange. */
const isNumbered = (spec: EventSpec) =>
  spec.class !== "resource.fs.zfs.removed";

function headerTimestamp(seconds: number, nanoseconds: number) {
  const at = new Date(seconds * 1000);
  return `${MONTHS[at.getUTCMonth()]} ${pad(at.getUTCDate())} ${at.getUTCFullYear()} ${pad(at.getUTCHours())}:${pad(at.getUTCMinutes())}:${pad(at.getUTCSeconds())}.${pad(nanoseconds, 9)}`;
}

function bootEvents(world: DemoWorld, host: HostModel, t: Date): EventSpec[] {
  const bootedAt = world.stories.lastBoot(host.name, t);
  return hostPoolsAt(world, host, t).flatMap((pool): EventSpec[] => {
    if (ms(pool.createdAt) > ms(bootedAt)) {
      return [
        { at: pool.createdAt, class: "sysevent.fs.zfs.pool_create", pool },
      ];
    }
    const importedAt = new Date(ms(bootedAt) + BOOT_IMPORT_DELAY_MS);
    return [
      { at: importedAt, class: "sysevent.fs.zfs.pool_import", pool },
      {
        at: new Date(ms(importedAt) + 1000),
        class: "sysevent.fs.zfs.config_sync",
        pool,
      },
    ];
  });
}

function storyEvent(
  world: DemoWorld,
  host: HostModel,
  event: ZpoolEvent,
): EventSpec {
  return {
    at: event.at,
    class: event.class,
    pool: world.stories.pool(host.name, event.pool),
    ...(event.vdevAlias && { vdevAlias: event.vdevAlias }),
    ...(event.vdevState && { vdevState: event.vdevState }),
  };
}

interface TimedSpec extends EventSpec {
  seed: string;
  seconds: number;
  nanoseconds: number;
}

/** Story instants are whole seconds; the kernel stamps nanoseconds, so events in one second keep a stable order. */
function timed(host: HostModel, spec: EventSpec): TimedSpec {
  const seed = `${host.name}:${spec.class}:${ms(spec.at)}:${spec.vdevAlias ?? spec.pool.name}`;
  return {
    ...spec,
    seed,
    seconds: Math.floor(ms(spec.at) / 1000),
    nanoseconds: forkRng(`event-ns:${seed}`).int(0, 999_999_999),
  };
}

const chronological = (a: TimedSpec, b: TimedSpec) =>
  a.seconds - b.seconds ||
  a.nanoseconds - b.nanoseconds ||
  (a.class < b.class ? -1 : 1);

function renderBlock(
  world: DemoWorld,
  host: HostModel,
  spec: TimedSpec,
  eid: number | null,
) {
  const fields: Field[] = [
    ...eventFields(world, host, spec, spec.seed),
    ["time", `${hexOf(spec.seconds)} ${hexOf(spec.nanoseconds)} `],
    ...(eid === null ? [] : ([["eid", hexOf(eid)]] as Field[])),
  ];
  const lines = fields.map(([key, value]) => {
    if (key === "(end detector)") return `        ${key}`;
    const indent = key.startsWith("  ") ? "                " : "        ";
    return `${indent}${key.trim()} = ${value}`;
  });
  return [
    `${headerTimestamp(spec.seconds, spec.nanoseconds)}\t${spec.class}`,
    ...lines,
    "",
  ].join("\n");
}

/** `zpool events -vH` since the host's last boot; eids restart at 1 on each boot. */
export function renderZpoolEvents(
  world: DemoWorld,
  host: HostModel,
  t: Date,
): string | null {
  const specs = [
    ...bootEvents(world, host, t),
    ...world.stories
      .zpoolEvents(host.name, t)
      .map((event) => storyEvent(world, host, event)),
  ]
    .filter((spec) => ms(spec.at) <= ms(t))
    .map((spec) => timed(host, spec))
    .sort(chronological);
  if (specs.length === 0) return null;
  let eid = 0;
  const blocks = specs.map((spec) =>
    renderBlock(world, host, spec, isNumbered(spec) ? ++eid : null),
  );
  return `${blocks.slice(-ZEVENT_RING_LENGTH).join("\n")}\n`;
}
