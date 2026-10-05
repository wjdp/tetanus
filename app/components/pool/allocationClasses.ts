type ClassRole = "special" | "dedup";

interface VdevLike {
  name: string;
  role: string;
  sizeBytes: number | null;
  allocBytes: number | null;
  children: VdevLike[];
}

export interface ClassVdev {
  name: string;
  role: ClassRole;
  sizeBytes: number | null;
  allocBytes: number | null;
}

const isClassRole = (role: string): role is ClassRole =>
  role === "special" || role === "dedup";

/** Special and dedup vdevs: counted in raw size and free, never in Available. */
export function allocationClassVdevs(root: VdevLike | null): ClassVdev[] {
  return (root?.children ?? []).flatMap(
    ({ name, role, sizeBytes, allocBytes }) =>
      isClassRole(role) ? [{ name, role, sizeBytes, allocBytes }] : [],
  );
}

/** Raw free on the normal vdevs, or null when a class vdev's size is unknown. */
export function mainVdevFree(
  poolFree: number | null,
  classVdevs: ClassVdev[],
): number | null {
  if (poolFree === null) return null;
  let free = poolFree;
  for (const { sizeBytes, allocBytes } of classVdevs) {
    if (sizeBytes === null || allocBytes === null) return null;
    free -= sizeBytes - allocBytes;
  }
  return free;
}
