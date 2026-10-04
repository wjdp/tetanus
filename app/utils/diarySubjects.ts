import type { DiarySubjectType } from "#shared/diary";
import { UNIDENTIFIED_DISK } from "#shared/disk";
import { ENTITY_ICON } from "~/utils/vocabulary";

export const DIARY_SUBJECT_ICON: Record<DiarySubjectType, string> = {
  disk: ENTITY_ICON.disk,
  pool: ENTITY_ICON.pool,
  vdev: "i-lucide-layers",
  dataset: ENTITY_ICON.dataset,
  replication: ENTITY_ICON.replication,
  host: ENTITY_ICON.host,
  system: ENTITY_ICON.diary,
};

export interface SubjectItem {
  label: string;
  value: number;
}

interface DiskOption {
  id: number;
  alias: string | null;
  model: string | null;
  serial: string | null;
}

interface VdevOption {
  id: number;
  name: string;
  type: string;
  children: VdevOption[];
}

interface PoolOption {
  id: number;
  name: string;
  host: { name: string };
  vdevs: VdevOption | null;
}

interface HostOption {
  id: number;
  name: string;
  displayName: string | null;
}

interface DatasetOption {
  id: number;
  name: string;
  host: { name: string; displayName: string | null };
}

export const diskSubjectItems = (disks: DiskOption[]): SubjectItem[] =>
  disks.map(({ id, alias, model, serial }) => ({
    label:
      [alias, model, serial].filter(Boolean).join(" · ") || UNIDENTIFIED_DISK,
    value: id,
  }));

export const poolSubjectItems = (pools: PoolOption[]): SubjectItem[] =>
  pools.map(({ id, name, host }) => ({
    label: `${host.name} · ${name}`,
    value: id,
  }));

export const vdevSubjectItems = (pools: PoolOption[]): SubjectItem[] =>
  pools.flatMap((pool) => {
    const prefix = `${pool.host.name} · ${pool.name}`;
    const walk = (node: VdevOption): SubjectItem[] => [
      ...(node.type === "root"
        ? []
        : [{ label: `${prefix} · ${node.name}`, value: node.id }]),
      ...node.children.flatMap(walk),
    ];
    return pool.vdevs ? walk(pool.vdevs) : [];
  });

export const hostSubjectItems = (hosts: HostOption[]): SubjectItem[] =>
  hosts.map(({ id, name, displayName }) => ({
    label: displayName ?? name,
    value: id,
  }));

export const datasetLabel = ({ name, host }: DatasetOption) =>
  `${host.displayName || host.name} · ${name}`;

export const datasetSubjectItems = (datasets: DatasetOption[]): SubjectItem[] =>
  datasets.map((dataset) => ({
    label: datasetLabel(dataset),
    value: dataset.id,
  }));

export async function fetchSubjectItems(
  subjectType: DiarySubjectType,
): Promise<SubjectItem[]> {
  switch (subjectType) {
    case "disk":
      return diskSubjectItems(await $fetch("/api/disks"));
    case "pool":
      return poolSubjectItems(await $fetch("/api/pools"));
    case "vdev":
      return vdevSubjectItems(await $fetch("/api/pools"));
    case "host":
      return hostSubjectItems(await $fetch("/api/hosts"));
    case "dataset":
      return [];
    default:
      return [];
  }
}
