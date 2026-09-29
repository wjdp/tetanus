import { ENTITY_ICON } from "~/utils/vocabulary";

export interface EntitySearchEntry {
  id: string;
  label: string;
  icon: string;
  to: string;
}

interface SearchableDisk {
  id: number;
  alias: string | null;
  model: string | null;
  serial: string | null;
}

interface SearchablePool {
  id: number;
  name: string;
  host: { name: string; displayName: string | null };
}

const joinLabel = (parts: (string | null | undefined)[]) =>
  parts.filter((part) => part).join(" · ");

export function diskSearchEntry(disk: SearchableDisk): EntitySearchEntry {
  return {
    id: `disk-${disk.id}`,
    label:
      joinLabel([disk.alias, disk.model, disk.serial]) || `Disk ${disk.id}`,
    icon: ENTITY_ICON.disk,
    to: `/disks/${disk.id}`,
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
    if (loading.value || (disks.value && pools.value)) return;
    loading.value = true;
    try {
      const [diskRows, poolRows] = await Promise.all([
        $fetch("/api/disks"),
        $fetch("/api/pools"),
      ]);
      disks.value = diskRows.map(diskSearchEntry);
      pools.value = poolRows.map(poolSearchEntry);
    } catch (error) {
      console.error("Could not load disks and pools for search", error);
    } finally {
      loading.value = false;
    }
  };

  return { disks, pools, loading, load };
};
