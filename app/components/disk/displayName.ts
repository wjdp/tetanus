import type { Purpose } from "#shared/usage";

interface Nameable {
  alias: string | null;
  hostName: string | null;
  purpose: Purpose | null;
}

export function displayName(disk: Nameable): string | null {
  if (disk.alias) return disk.alias;
  if (disk.hostName && disk.purpose)
    return `${disk.hostName} · ${disk.purpose}`;
  return null;
}

export function diskLabel(
  disk: Nameable & { id: number; serial: string | null },
): string {
  return displayName(disk) ?? disk.serial ?? `disk ${disk.id}`;
}
