import type { BadgeProps } from "@nuxt/ui";
import { type Disposal, describeDisk, UNIDENTIFIED_DISK } from "#shared/disk";
import {
  DISPOSAL_VOCABULARY,
  disposalLabel,
  ENTITY_ICON,
} from "~/utils/vocabulary";

export interface EntitySearchEntry {
  id: string;
  label: string;
  icon: string;
  to: string;
  badge?: BadgeProps;
}

interface SearchableDisk {
  id: number;
  alias: string | null;
  model: string | null;
  serial: string | null;
  disposal?: Disposal | null;
  replacedByDiskId?: number | null;
}

interface SearchableHost {
  id: number;
  name: string;
  displayName: string | null;
}

interface SearchablePool {
  id: number;
  name: string;
  host: { name: string; displayName: string | null };
}

const joinLabel = (parts: (string | null | undefined)[]) =>
  parts.filter((part) => part).join(" · ");

function disposalBadge(
  disposal: Disposal,
  replacedByDiskId: number | null,
  labelOf: (id: number) => string | null | undefined,
): BadgeProps {
  return {
    label: disposalLabel(disposal, {
      replacedByDiskId,
      replacedByLabel:
        replacedByDiskId === null ? null : labelOf(replacedByDiskId),
    }),
    icon: DISPOSAL_VOCABULARY[disposal.kind].icon,
    color: DISPOSAL_VOCABULARY[disposal.kind].colour,
    variant: "subtle",
  };
}

export function diskSearchEntry(
  disk: SearchableDisk,
  labelOf: (id: number) => string | null | undefined = () => null,
): EntitySearchEntry {
  return {
    id: `disk-${disk.id}`,
    label:
      joinLabel([disk.alias, disk.model, disk.serial]) || UNIDENTIFIED_DISK,
    icon: ENTITY_ICON.disk,
    to: `/disks/${disk.id}`,
    ...(disk.disposal && {
      badge: disposalBadge(
        disk.disposal,
        disk.replacedByDiskId ?? null,
        labelOf,
      ),
    }),
  };
}

export function hostSearchEntry(host: SearchableHost): EntitySearchEntry {
  return {
    id: `host-${host.id}`,
    label: joinLabel([host.displayName, host.name]),
    icon: ENTITY_ICON.host,
    to: `/hosts/${host.id}`,
  };
}

export function poolSearchEntry(pool: SearchablePool): EntitySearchEntry {
  return {
    id: `pool-${pool.id}`,
    label: joinLabel([pool.name, pool.host.displayName || pool.host.name]),
    icon: ENTITY_ICON.pool,
    to: `/zfs/${pool.id}`,
  };
}

export const useEntitySearch = () => {
  const hosts = useState<EntitySearchEntry[] | null>(
    "entitySearchHosts",
    () => null,
  );
  const disks = useState<EntitySearchEntry[] | null>(
    "entitySearchDisks",
    () => null,
  );
  const pools = useState<EntitySearchEntry[] | null>(
    "entitySearchPools",
    () => null,
  );
  const loading = useState("entitySearchLoading", () => false);

  const load = async () => {
    if (loading.value || (hosts.value && disks.value && pools.value)) return;
    loading.value = true;
    try {
      const [hostRows, diskRows, poolRows] = await Promise.all([
        $fetch("/api/hosts"),
        $fetch("/api/disks"),
        $fetch("/api/pools"),
      ]);
      hosts.value = hostRows.map(hostSearchEntry);
      const labels = new Map(
        diskRows.map((row) => [row.id, describeDisk(row)]),
      );
      disks.value = diskRows.map((row) =>
        diskSearchEntry(row, (id) => labels.get(id)),
      );
      pools.value = poolRows.map(poolSearchEntry);
    } catch (error) {
      console.error("Could not load hosts, disks and pools for search", error);
    } finally {
      loading.value = false;
    }
  };

  return { hosts, disks, pools, loading, load };
};
