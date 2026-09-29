import type { Parser } from "#shared/ingest";
import { ParseError } from "./parseError";

export interface LsblkChild {
  name: string;
  path: string;
  type: string;
  fsType: string | null;
  mountPoints: string[] | null;
  children: LsblkChild[];
}

export interface LsblkPartition {
  name: string;
  path: string;
  majMin: string;
  sizeBytes: number;
  partUuid: string | null;
  fsType: string | null;
  mountPoints: string[] | null;
  children: LsblkChild[];
}

export interface LsblkDisk {
  name: string;
  path: string;
  majMin: string;
  sizeBytes: number;
  model: string | null;
  serial: string | null;
  wwn: string | null;
  link: string | null;
  rotational: boolean;
  zoned: string | null;
  logicalBlockSize: number | null;
  physicalBlockSize: number | null;
  partitionTableType: string | null;
  fsType: string | null;
  mountPoints: string[] | null;
  children: LsblkChild[];
  partitions: LsblkPartition[];
}

export interface LsblkResult {
  disks: LsblkDisk[];
}

type Json = Record<string, unknown>;

function stripWwnPrefix(wwn: unknown): string | null {
  if (typeof wwn !== "string") return null;
  return wwn.replace(/^0x/i, "").toLowerCase();
}

function blockSizeOf(value: unknown): number | null {
  const size = typeof value === "string" ? Number(value) : value;
  return typeof size === "number" && Number.isInteger(size) && size > 0
    ? size
    : null;
}

function mountPointsOf(entry: Json): string[] | null {
  if (Array.isArray(entry.mountpoints)) {
    return (entry.mountpoints as unknown[]).filter(
      (mountPoint): mountPoint is string => typeof mountPoint === "string",
    );
  }
  if ("mountpoint" in entry) {
    return typeof entry.mountpoint === "string" ? [entry.mountpoint] : [];
  }
  return null;
}

function rawChildrenOf(entry: Json): Json[] {
  return Array.isArray(entry.children) ? (entry.children as Json[]) : [];
}

function mapperChildrenOf(entry: Json): LsblkChild[] {
  return rawChildrenOf(entry)
    .filter((child) => child.type !== "part")
    .map(toChild);
}

function toChild(entry: Json): LsblkChild {
  return {
    name: entry.name as string,
    path: entry.path as string,
    type: entry.type as string,
    fsType: (entry.fstype as string | null) ?? null,
    mountPoints: mountPointsOf(entry),
    children: mapperChildrenOf(entry),
  };
}

function toPartition(entry: Json): LsblkPartition {
  return {
    name: entry.name as string,
    path: entry.path as string,
    majMin: entry["maj:min"] as string,
    sizeBytes: entry.size as number,
    partUuid: (entry.partuuid as string | null) ?? null,
    fsType: (entry.fstype as string | null) ?? null,
    mountPoints: mountPointsOf(entry),
    children: mapperChildrenOf(entry),
  };
}

function toDisk(entry: Json): LsblkDisk {
  const partitions = rawChildrenOf(entry)
    .filter((child) => child.type === "part")
    .map(toPartition);

  return {
    name: entry.name as string,
    path: entry.path as string,
    majMin: entry["maj:min"] as string,
    sizeBytes: entry.size as number,
    model: (entry.model as string | null) ?? null,
    serial: (entry.serial as string | null) ?? null,
    wwn: stripWwnPrefix(entry.wwn),
    link: (entry.tran as string | null) ?? null,
    rotational: Boolean(entry.rota),
    zoned: (entry.zoned as string | null) ?? null,
    logicalBlockSize: blockSizeOf(entry["log-sec"]),
    physicalBlockSize: blockSizeOf(entry["phy-sec"]),
    partitionTableType: (entry.pttype as string | null) ?? null,
    fsType: (entry.fstype as string | null) ?? null,
    mountPoints: mountPointsOf(entry),
    children: mapperChildrenOf(entry),
    partitions,
  };
}

export const parse: Parser<LsblkResult> = (body) => {
  if (body.trim() === "") throw new ParseError("Empty lsblk body");
  let json: unknown;
  try {
    json = JSON.parse(body);
  } catch {
    throw new ParseError("lsblk body is not valid JSON");
  }
  if (typeof json !== "object" || json === null) {
    throw new ParseError("lsblk body is not a JSON object");
  }

  const blockdevices = (json as Json).blockdevices;
  if (!Array.isArray(blockdevices)) {
    throw new ParseError("lsblk body missing blockdevices array");
  }

  const disks = (blockdevices as Json[])
    .filter((entry) => entry.type === "disk")
    .map(toDisk);

  const partitions = disks.reduce(
    (total, disk) => total + disk.partitions.length,
    0,
  );

  return { data: { disks }, summary: { disks: disks.length, partitions } };
};
