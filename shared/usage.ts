export const USAGE_KINDS = ["zfs", "filesystem", "empty", "unknown"] as const;
export type UsageKind = (typeof USAGE_KINDS)[number];

export interface DiskMount {
  fsType: string;
  path: string;
  via: string[];
}

export interface DiskUsage {
  kind: UsageKind;
  fsTypes: string[];
  mounts: DiskMount[];
  system: boolean;
}

export const UNKNOWN_USAGE: DiskUsage = {
  kind: "unknown",
  fsTypes: [],
  mounts: [],
  system: false,
};

export const PURPOSES = ["system"] as const;
export type Purpose = (typeof PURPOSES)[number];

export function isMounted(usage: DiskUsage): boolean {
  return usage.kind === "filesystem" && usage.mounts.length > 0;
}

function describeMounts(mounts: DiskMount[]): string {
  const groups = new Map<string, { head: DiskMount; paths: string[] }>();
  for (const mount of mounts) {
    const key = JSON.stringify([mount.fsType, mount.via]);
    const group = groups.get(key);
    if (group) group.paths.push(mount.path);
    else groups.set(key, { head: mount, paths: [mount.path] });
  }
  return [...groups.values()]
    .map(({ head, paths }) => {
      const chain = head.via.length ? ` (${head.via.join(", ")})` : "";
      return `${head.fsType} on ${paths.join(", ")}${chain}`;
    })
    .join(", ");
}

export function usageDetail(usage: DiskUsage, poolName: string | null): string {
  switch (usage.kind) {
    case "zfs":
      return poolName ?? "zfs label, no pool";
    case "filesystem":
      return usage.mounts.length
        ? describeMounts(usage.mounts)
        : `has ${usage.fsTypes.join(", ")} data`;
    case "empty":
      return "empty";
    case "unknown":
      return "usage unknown";
  }
}

export function usageShort(usage: DiskUsage): string | null {
  switch (usage.kind) {
    case "zfs":
      return "zfs";
    case "filesystem": {
      const [first] = usage.mounts;
      return first ? `${first.fsType} ${first.path}` : usage.fsTypes.join(", ");
    }
    case "empty":
      return "empty";
    case "unknown":
      return null;
  }
}
