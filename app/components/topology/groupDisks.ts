import type { EffectiveDiskState, StateOverride } from "#shared/disk";
import type { Media } from "#shared/hardware";
import type { DeviceStatus } from "#shared/smart/status";
import type { TemperatureThresholds } from "#shared/temperature";
import type { Purpose } from "#shared/usage";
import {
  DEVICE_STATUS_VOCABULARY,
  type DotShape,
  LIFECYCLE_VOCABULARY,
  type StatusColour,
  worstColour,
  zfsStateColour,
} from "~/utils/vocabulary";
import type { PoolScan } from "../pool/scan";

export interface TopologyDiskFacts {
  id: number;
  alias: string | null;
  latestStatus: DeviceStatus;
  capacityBytes: number | null;
  media: Media | null;
  purpose: Purpose | null;
  latestTemp: number | null;
  modelShort: string | null;
  tempThresholds: TemperatureThresholds;
}

export interface TopologyVdevDisk extends TopologyDiskFacts {
  state: string | null;
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
  sizeBytes: number | null;
  allocBytes: number | null;
  disk: TopologyVdevDisk | null;
  children: TopologyVdev[];
}

export interface TopologyDisk extends TopologyDiskFacts {
  model: string | null;
  serial: string | null;
  interfaceLabel: string | null;
  state: EffectiveDiskState;
  stateOverride: StateOverride | null;
  present: boolean;
  lastSeenHostId: number | null;
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
  type: string;
  isClass: boolean;
  label: string;
  state: string | null;
  sizeBytes: number | null;
  allocBytes: number | null;
  leaves: TopologyVdev[];
}

export interface DiskGroup<Disk extends TopologyDisk = TopologyDisk> {
  key: string;
  state: EffectiveDiskState | null;
  label: string;
  icon: string;
  disks: Disk[];
}

export interface Dot {
  colour: StatusColour;
  shape: DotShape;
}

const CLASS_ORDER = ["special", "log", "cache", "dedup", "spare"];
const CLASS_TYPES = new Set(CLASS_ORDER);

const classRank = (group: VdevGroup) => CLASS_ORDER.indexOf(group.type);

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

function sumKnown(values: (number | null)[]): number | null {
  if (values.length === 0 || values.some((value) => value === null)) {
    return null;
  }
  return values.reduce<number>((total, value) => total + (value ?? 0), 0);
}

export function vdevGroups(root: TopologyVdev | null): VdevGroup[] {
  if (!root) return [];
  const groups: VdevGroup[] = [];
  const singles = new Map<string, VdevGroup>();
  for (const child of root.children) {
    if (child.children.length > 0) {
      groups.push({
        key: child.guid,
        type: child.type,
        isClass: CLASS_TYPES.has(child.type),
        label: groupLabel(child),
        state: child.state,
        sizeBytes: child.sizeBytes,
        allocBytes: child.allocBytes,
        leaves: leafVdevs(child),
      });
      continue;
    }
    const label = SINGLE_DEVICE_LABEL[child.type] ?? child.type;
    const existing = singles.get(label);
    if (existing) {
      existing.leaves.push(child);
    } else {
      const group: VdevGroup = {
        key: `single-${label}`,
        type: child.type,
        isClass: CLASS_TYPES.has(child.type),
        label,
        state: null,
        sizeBytes: null,
        allocBytes: null,
        leaves: [child],
      };
      singles.set(label, group);
      groups.push(group);
    }
  }
  for (const group of singles.values()) {
    group.sizeBytes = sumKnown(group.leaves.map((leaf) => leaf.sizeBytes));
    group.allocBytes = sumKnown(group.leaves.map((leaf) => leaf.allocBytes));
  }
  return groups.sort((a, b) => classRank(a) - classRank(b));
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

interface GroupSpec {
  key: string;
  state: EffectiveDiskState | null;
  label: string;
  icon: string;
  matches: (disk: TopologyDisk) => boolean;
}

function byState(state: EffectiveDiskState, label?: string): GroupSpec {
  const vocabulary = LIFECYCLE_VOCABULARY[state];
  return {
    key: state,
    state,
    label: label ?? vocabulary.label,
    icon: vocabulary.icon,
    matches: (disk) => disk.state === state,
  };
}

const HOST_GROUPS: GroupSpec[] = [
  {
    key: "system",
    state: null,
    label: "system",
    icon: "i-lucide-cpu",
    matches: (disk) => disk.purpose === "system",
  },
  ...[
    byState("spare"),
    byState("in-use", "in use, not in a pool"),
    byState("removed"),
    byState("dead"),
    byState("retired"),
    byState("sold"),
  ].map((spec) => ({
    ...spec,
    matches: (disk: TopologyDisk) =>
      disk.purpose !== "system" && spec.matches(disk),
  })),
];

const HISTORY_STATES = new Set<EffectiveDiskState>(["dead", "retired", "sold"]);

export const HISTORY_KEY = "history";

const RAIL_GROUPS: GroupSpec[] = [
  byState("missing"),
  byState("removed"),
  byState("unseen"),
  byState("spare"),
  byState("in-use", "In use, not in a pool"),
  {
    key: HISTORY_KEY,
    state: null,
    label: "History",
    icon: "i-lucide-history",
    matches: (disk) => HISTORY_STATES.has(disk.state),
  },
];

function groupBy<Disk extends TopologyDisk>(
  specs: GroupSpec[],
  disks: Disk[],
): DiskGroup<Disk>[] {
  return specs
    .map(({ key, state, label, icon, matches }) => ({
      key,
      state,
      label,
      icon,
      disks: disks.filter(matches),
    }))
    .filter((group) => group.disks.length > 0);
}

export function hostDiskGroups<Disk extends TopologyDisk>(
  disks: Disk[],
  hostId: number,
  inPool: Set<number>,
): DiskGroup<Disk>[] {
  return groupBy(
    HOST_GROUPS,
    disks.filter(
      (disk) =>
        disk.present && disk.lastSeenHostId === hostId && !inPool.has(disk.id),
    ),
  );
}

export function railGroups<Disk extends TopologyDisk>(
  disks: Disk[],
  inPool: Set<number>,
): DiskGroup<Disk>[] {
  return groupBy(
    RAIL_GROUPS,
    disks.filter((disk) => !disk.present && !inPool.has(disk.id)),
  );
}

export interface HostDiskSummary {
  count: number;
  hdd: number;
  ssd: number;
  rawBytes: number | null;
}

export function hostDiskSummary(disks: TopologyDisk[]): HostDiskSummary {
  const capacities = disks
    .map((disk) => disk.capacityBytes)
    .filter((bytes): bytes is number => bytes !== null);
  return {
    count: disks.length,
    hdd: disks.filter((disk) => disk.media === "hdd").length,
    ssd: disks.filter((disk) => disk.media === "ssd").length,
    rawBytes:
      capacities.length > 0
        ? capacities.reduce((total, bytes) => total + bytes, 0)
        : null,
  };
}

function smartDot(status: DeviceStatus, ...others: StatusColour[]): Dot {
  const smart = DEVICE_STATUS_VOCABULARY[status];
  return { colour: worstColour(smart.colour, ...others), shape: smart.shape };
}

export function tileColour(leaf: TopologyVdev): Dot {
  if (!leaf.disk) return { colour: "neutral", shape: "hollow" };
  return smartDot(leaf.disk.latestStatus, zfsStateColour(leaf.state));
}

export function diskDot(disk: TopologyDisk): Dot {
  return smartDot(disk.latestStatus, LIFECYCLE_VOCABULARY[disk.state].colour);
}

export function leafLabel(leaf: TopologyVdev): string {
  if (leaf.disk?.alias) return leaf.disk.alias;
  const basename = leaf.name.split("/").pop() ?? leaf.name;
  return basename.replace(/-part\d+$/, "");
}

export function diskLabel(disk: TopologyDisk): string {
  return disk.alias ?? disk.serial ?? `#${disk.id}`;
}

export function hasErrors(leaf: TopologyVdev): boolean {
  return leaf.readErrors + leaf.writeErrors + leaf.checksumErrors > 0;
}
