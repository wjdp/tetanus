import { byIdNames, vdevGuid } from "./fleet";
import type {
  DiskModel,
  HostModel,
  LeafAt,
  PoolModel,
  VdevModel,
} from "./types";
import type { DemoWorld } from "./world";

const INT_MARKER = /"@@int:(\d+)@@"/g;

/** A 64-bit integer the JSON must carry unquoted (GUIDs), as `--json-int` prints them. */
export function bigInt(value: string): string {
  return `@@int:${value}@@`;
}

export function jsonWithBigInts(value: unknown): string {
  return `${JSON.stringify(value).replace(INT_MARKER, "$1")}\n`;
}

export interface PropertySource {
  type: "NONE" | "DEFAULT" | "LOCAL" | "INHERITED";
  data: string;
}

export const NO_SOURCE: PropertySource = { type: "NONE", data: "-" };
export const DEFAULT_SOURCE: PropertySource = { type: "DEFAULT", data: "-" };
export const LOCAL_SOURCE: PropertySource = { type: "LOCAL", data: "-" };

export function property(
  value: number | string,
  source: PropertySource = NO_SOURCE,
) {
  return { value, source };
}

export const epochSeconds = (date: Date) => Math.floor(date.getTime() / 1000);

const TXG_INTERVAL_MS = 10_000;

export function txgAt(pool: PoolModel, at: Date): number {
  return (
    4 +
    Math.max(
      0,
      Math.floor((at.getTime() - pool.createdAt.getTime()) / TXG_INTERVAL_MS),
    )
  );
}

export function hostPoolsAt(
  world: DemoWorld,
  host: HostModel,
  t: Date,
): PoolModel[] {
  return world.fleet.pools
    .filter(
      (pool) =>
        pool.host === host.name && pool.createdAt.getTime() <= t.getTime(),
    )
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

const MIB = 1024 * 1024;

export function leafPartition(disk: DiskModel): number {
  return disk.layout.kind === "zfs-boot" ? 2 : 1;
}

/** Boot pools are created on by-id partition paths; data pools on vdev_id.conf hosts use by-vdev aliases. */
function usesByVdev(host: HostModel, disk: DiskModel) {
  return host.vdevIdConf && disk.layout.kind !== "zfs-boot";
}

export function leafDevid(disk: DiskModel): string {
  return `${byIdNames(disk)[0]}-part${leafPartition(disk)}`;
}

/** The stored path `zpool status -P` prints. */
export function leafPath(host: HostModel, disk: DiskModel): string {
  return usesByVdev(host, disk)
    ? `/dev/disk/by-vdev/${disk.alias}-part1`
    : `/dev/disk/by-id/${leafDevid(disk)}`;
}

/** The short name `zpool list -v` prints: whole-disk vdevs drop `-part1`. */
export function leafListName(host: HostModel, disk: DiskModel): string {
  if (usesByVdev(host, disk)) return disk.alias;
  return disk.layout.kind === "zfs-boot"
    ? leafDevid(disk)
    : (byIdNames(disk)[0] ?? disk.alias);
}

export function leafPhysPath(disk: DiskModel): string {
  if (disk.transport === "nvme") {
    const controller = Number(/^nvme(\d+)/.exec(disk.kernelName)?.[1] ?? 0);
    return `pci-0000:0${controller + 3}:00.0-nvme-1`;
  }
  const slot = disk.kernelName.charCodeAt(2) - "a".charCodeAt(0);
  return disk.transport === "sas"
    ? `pci-0000:01:00.0-sas-phy${slot}-lun-0`
    : `pci-0000:00:17.0-ata-${slot + 1}.0`;
}

/** Partition size ZFS sees: whole-disk leaves lose the 8 MiB part9 and alignment, boot leaves the ESP. */
export function leafPhysSpace(disk: DiskModel): number {
  const reserved = disk.layout.kind === "zfs-boot" ? 514 * MIB : 10 * MIB;
  return disk.capacityBytes - reserved;
}

export function leafRepDevSize(disk: DiskModel): number {
  return Math.floor(leafPhysSpace(disk) * 0.99976);
}

export function leafGuid(pool: PoolModel, disk: DiskModel): string {
  return vdevGuid(pool, `leaf:${disk.alias}`);
}

export function groupName(vdev: VdevModel): string {
  return `${vdev.type}-${vdev.index ?? 0}`;
}

export function groupGuid(pool: PoolModel, vdev: VdevModel): string {
  return vdevGuid(pool, `group:${vdev.class}:${groupName(vdev)}`);
}

export function replacingName(leaf: LeafAt): string {
  return `replacing-${leaf.position}`;
}

export function replacingGuid(pool: PoolModel, incoming: DiskModel): string {
  return vdevGuid(pool, `replacing:${incoming.alias}`);
}

export const hexOf = (decimal: string | number) =>
  `0x${BigInt(decimal).toString(16)}`;
