import type { EffectiveDiskState } from "#shared/disk";
import type { Media } from "#shared/hardware";
import type { DeviceStatus } from "#shared/smart/status";
import type { Purpose } from "#shared/usage";
import {
  deviceStatusColour,
  diskStateColour,
  type StatusColour,
  zfsStateColour,
} from "~/utils/statusColour";
import type { PoolScan } from "../pool/scan";

export interface TopologyVdevDisk {
  id: number;
  alias: string | null;
  state: string | null;
  latestStatus: DeviceStatus;
}

export interface TopologyVdev {
  id: number;
  guid: string;
  name: string;
  type: string;
  state: string;
  readErrors: number;
  writeErrors: number;
  checksumErrors: number;
  slowIos: number | null;
  path: string | null;
  disk: TopologyVdevDisk | null;
  children: TopologyVdev[];
}

export interface TopologyDisk {
  id: number;
  alias: string | null;
  model: string | null;
  serial: string | null;
  state: EffectiveDiskState;
  purpose: Purpose | null;
  media: Media | null;
  latestStatus: DeviceStatus;
}

export interface TopologyPool {
  id: number;
  name: string;
  state: string;
  sizeBytes: number | null;
  allocBytes: number | null;
  cap: number | null;
  frag: number | null;
  scan: PoolScan | null;
  vdevs: TopologyVdev | null;
}

export interface VdevGroup {
  key: string;
  label: string;
  state: string | null;
  leaves: TopologyVdev[];
}

export interface RailGroup<Disk extends TopologyDisk = TopologyDisk> {
  key: string;
  label: string;
  disks: Disk[];
}

const CLASS_TYPES = new Set(["log", "cache", "special", "dedup", "spare"]);

const SINGLE_DEVICE_LABEL: Record<string, string> = {
  disk: "stripe",
  file: "stripe",
  log: "log",
  cache: "cache",
  spare: "spares",
  special: "special",
  dedup: "dedup",
};

export function leafVdevs(node: TopologyVdev): TopologyVdev[] {
  if (node.children.length === 0) return [node];
  return node.children.flatMap(leafVdevs);
}

function groupLabel(node: TopologyVdev) {
  return CLASS_TYPES.has(node.type) ? `${node.type} · ${node.name}` : node.name;
}

export function vdevGroups(root: TopologyVdev | null): VdevGroup[] {
  if (!root) return [];
  const groups: VdevGroup[] = [];
  const singles = new Map<string, VdevGroup>();
  for (const child of root.children) {
    if (child.children.length > 0) {
      groups.push({
        key: child.guid,
        label: groupLabel(child),
        state: child.state,
        leaves: leafVdevs(child),
      });
      continue;
    }
    const label = SINGLE_DEVICE_LABEL[child.type] ?? child.type;
    const existing = singles.get(label);
    if (existing) {
      existing.leaves.push(child);
    } else {
      const group = {
        key: `single-${label}`,
        label,
        state: null,
        leaves: [child],
      };
      singles.set(label, group);
      groups.push(group);
    }
  }
  return groups;
}

export function linkedDiskIds(roots: (TopologyVdev | null)[]): Set<number> {
  const ids = new Set<number>();
  for (const root of roots) {
    if (!root) continue;
    for (const leaf of leafVdevs(root)) {
      if (leaf.disk) ids.add(leaf.disk.id);
    }
  }
  return ids;
}

interface RailSpec {
  key: string;
  label: string;
  matches: (disk: TopologyDisk) => boolean;
}

function byState(state: EffectiveDiskState, label: string): RailSpec {
  return {
    key: state,
    label,
    matches: (disk) => disk.state === state && disk.purpose !== "system",
  };
}

const RAIL_ORDER: RailSpec[] = [
  {
    key: "system",
    label: "System",
    matches: (disk) => disk.purpose === "system",
  },
  byState("spare", "Spare"),
  byState("missing", "Missing"),
  byState("removed", "Removed"),
  byState("unseen", "Unseen"),
  byState("in-use", "In use, not in a pool"),
  byState("dead", "Dead"),
  byState("retired", "Retired"),
  byState("sold", "Sold"),
];

export function railGroups<Disk extends TopologyDisk>(
  disks: Disk[],
  inPool: Set<number>,
): RailGroup<Disk>[] {
  const outside = disks.filter((disk) => !inPool.has(disk.id));
  return RAIL_ORDER.map(({ key, label, matches }) => ({
    key,
    label,
    disks: outside.filter(matches),
  })).filter((group) => group.disks.length > 0);
}

const COLOUR_SEVERITY: Record<StatusColour, number> = {
  neutral: 0,
  success: 1,
  info: 2,
  warning: 3,
  error: 4,
};

export function worstColour(...colours: StatusColour[]): StatusColour {
  return colours.reduce<StatusColour>(
    (worst, colour) =>
      COLOUR_SEVERITY[colour] > COLOUR_SEVERITY[worst] ? colour : worst,
    "neutral",
  );
}

export function tileColour(leaf: TopologyVdev): StatusColour {
  const status = leaf.disk?.latestStatus ?? "unknown";
  const worst = worstColour(
    deviceStatusColour(status),
    zfsStateColour(leaf.state),
  );
  if (worst === "neutral" && status === "passed") return "success";
  return worst;
}

export function railColour(disk: TopologyDisk): StatusColour {
  const worst = worstColour(
    deviceStatusColour(disk.latestStatus),
    diskStateColour(disk.state),
  );
  if (worst === "neutral" && disk.latestStatus === "passed") return "success";
  return worst;
}

export function leafLabel(leaf: TopologyVdev): string {
  if (leaf.disk?.alias) return leaf.disk.alias;
  const basename = leaf.name.split("/").pop() ?? leaf.name;
  return basename.replace(/-part\d+$/, "");
}

export function hasErrors(leaf: TopologyVdev): boolean {
  return leaf.readErrors + leaf.writeErrors + leaf.checksumErrors > 0;
}
