import type { Inventory } from "#shared/inventory-fields";
import type { DiskMount, DiskUsage, Purpose, UsageKind } from "#shared/usage";
import type { LsblkChild, LsblkDisk } from "~~/server/ingest/lsblk";

const SYSTEM_MOUNT_PATHS = new Set(["/", "/boot"]);
const MAPPER_NAMES: Record<string, string> = { crypt: "luks", lvm: "lvm" };

interface UsageNode {
  fsType: string | null;
  mountPoints: string[] | null;
  via: string[];
}

function mapperName(type: string): string {
  return MAPPER_NAMES[type] ?? type;
}

function* walkChildren(
  children: LsblkChild[],
  via: string[],
): Generator<UsageNode> {
  for (const child of children) {
    const childVia = [...via, mapperName(child.type)];
    yield {
      fsType: child.fsType,
      mountPoints: child.mountPoints,
      via: childVia,
    };
    yield* walkChildren(child.children, childVia);
  }
}

function* walkDisk(disk: LsblkDisk): Generator<UsageNode> {
  for (const device of [disk, ...disk.partitions]) {
    yield { fsType: device.fsType, mountPoints: device.mountPoints, via: [] };
    yield* walkChildren(device.children, []);
  }
}

function kindOf(nodes: UsageNode[]): UsageKind {
  const formatted = nodes.filter((node) => node.fsType !== null);
  if (formatted.some((node) => node.fsType === "zfs_member")) return "zfs";
  if (formatted.some((node) => node.mountPoints === null)) return "unknown";
  return formatted.length > 0 ? "filesystem" : "empty";
}

export function inferUsage(disk: LsblkDisk): DiskUsage {
  const nodes = [...walkDisk(disk)];
  const fsTypes = [
    ...new Set(nodes.flatMap((node) => (node.fsType ? [node.fsType] : []))),
  ].sort();
  const mounts: DiskMount[] = nodes.flatMap(({ fsType, mountPoints, via }) =>
    fsType ? (mountPoints ?? []).map((path) => ({ fsType, path, via })) : [],
  );
  return {
    kind: kindOf(nodes),
    fsTypes,
    mounts,
    system: mounts.some((mount) => SYSTEM_MOUNT_PATHS.has(mount.path)),
  };
}

export interface ResolvedPurpose {
  purpose: Purpose | null;
  purposeInferred: boolean;
}

export function resolvePurpose(
  inventory: Partial<Inventory>,
  usage: Pick<DiskUsage, "system"> | null,
): ResolvedPurpose {
  const chosen = inventory.purpose ?? null;
  if (chosen !== null) return { purpose: chosen, purposeInferred: false };
  return usage?.system
    ? { purpose: "system", purposeInferred: true }
    : { purpose: null, purposeInferred: false };
}
