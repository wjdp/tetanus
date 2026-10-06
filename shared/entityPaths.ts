export const ROOT_DATASET_SEGMENT = "~root";
const SUFFIX_SEPARATOR = "~";
const GUID_SUFFIX_LENGTH = 6;

export interface SluggablePool {
  id: number;
  hostId: number;
  name: string;
  guid: string;
  archivedAt: Date | null;
  lastSeenAt: Date;
}

export interface ZfsPathTarget {
  poolSlug: string;
  datasetName: string | null;
}

const encodeSegments = (path: string) =>
  path.split("/").map(encodeURIComponent).join("/");

export const hostPath = (hostName: string) =>
  `/hosts/${encodeURIComponent(hostName)}`;

export const poolPath = (hostName: string, poolSlug: string) =>
  `/zfs/${encodeURIComponent(hostName)}/${encodeURIComponent(poolSlug)}`;

/** `datasetName` is the full ZFS name; its first segment is the pool and is replaced by `poolPathOf` (the pool's page path). */
export function datasetPath(poolPathOf: string, datasetName: string): string {
  const slash = datasetName.indexOf("/");
  if (slash === -1) return `${poolPathOf}/${ROOT_DATASET_SEGMENT}`;
  return `${poolPathOf}/${encodeSegments(datasetName.slice(slash + 1))}`;
}

const canonicalFirst = (a: SluggablePool, b: SluggablePool) =>
  Number(a.archivedAt !== null) - Number(b.archivedAt !== null) ||
  b.lastSeenAt.getTime() - a.lastSeenAt.getTime() ||
  b.id - a.id;

/** The canonical pool of each host and name keeps the bare name; the rest get a guid suffix, the whole guid if the short one is ambiguous. */
export function poolSlugs(pools: SluggablePool[]): Map<number, string> {
  const groups = new Map<string, SluggablePool[]>();
  for (const pool of pools) {
    const key = `${pool.hostId}\0${pool.name}`;
    groups.set(key, [...(groups.get(key) ?? []), pool]);
  }
  const slugs = new Map<number, string>();
  for (const group of groups.values()) {
    const [canonical, ...others] = group.sort(canonicalFirst);
    slugs.set(canonical.id, canonical.name);
    const shortSuffix = (pool: SluggablePool) =>
      pool.guid.slice(-GUID_SUFFIX_LENGTH);
    for (const pool of others) {
      const ambiguous = others.some(
        (other) =>
          other.id !== pool.id && shortSuffix(other) === shortSuffix(pool),
      );
      const suffix = ambiguous ? pool.guid : shortSuffix(pool);
      slugs.set(pool.id, `${pool.name}${SUFFIX_SEPARATOR}${suffix}`);
    }
  }
  return slugs;
}

/** Splits decoded catch-all segments after `/zfs/<host>/`; null when there is no pool segment. */
export function parseZfsPath(segments: string[]): ZfsPathTarget | null {
  const [poolSlug, ...rest] = segments.filter((segment) => segment !== "");
  if (!poolSlug) return null;
  const poolName = poolSlug.split(SUFFIX_SEPARATOR)[0];
  if (rest.length === 0) return { poolSlug, datasetName: null };
  if (rest.length === 1 && rest[0] === ROOT_DATASET_SEGMENT) {
    return { poolSlug, datasetName: poolName };
  }
  return { poolSlug, datasetName: [poolName, ...rest].join("/") };
}
