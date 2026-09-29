import { interfaceLabel, sectorFormat } from "#shared/hardware";
import { usageShort } from "#shared/usage";
import type { InventoryDisk, SortingState } from "./types";

type SortValue = string | number | null;

export interface SortField {
  id: string;
  label: string;
  value: (disk: InventoryDisk) => SortValue;
}

export const SORT_FIELDS: SortField[] = [
  { id: "alias", label: "Alias", value: (disk) => disk.alias },
  { id: "model", label: "Model", value: (disk) => disk.model },
  { id: "capacity", label: "Capacity", value: (disk) => disk.capacityBytes },
  {
    id: "vendor",
    label: "Vendor",
    value: (disk) => vendorLabel(disk.vendor),
  },
  {
    id: "media",
    label: "Media",
    value: (disk) => mediaLabel(disk.media, disk.rotationRate),
  },
  {
    id: "interface",
    label: "Interface",
    value: (disk) => interfaceLabel(disk.interface, disk.link),
  },
  {
    id: "recording",
    label: "Recording",
    value: (disk) => knownRecordingTech(disk.recordingTech),
  },
  {
    id: "sectors",
    label: "Sectors",
    value: (disk) =>
      sectorFormat(disk.logicalBlockSize, disk.physicalBlockSize),
  },
  { id: "host", label: "Host", value: (disk) => disk.hostName },
  {
    id: "pool",
    label: "Pool",
    value: (disk) => disk.membership?.poolName ?? disk.purpose ?? null,
  },
  {
    id: "usage",
    label: "Usage",
    value: (disk) => usageShort(disk.usage, disk.membership?.poolName ?? null),
  },
  { id: "state", label: "State", value: (disk) => disk.state },
  { id: "status", label: "Status", value: (disk) => disk.latestStatus },
  { id: "temp", label: "Temp", value: (disk) => disk.latestTemp },
  {
    id: "powerOn",
    label: "Power-on",
    value: (disk) => disk.latestPowerOnHours,
  },
  { id: "age", label: "Age", value: (disk) => disk.ageDays },
  { id: "warranty", label: "Warranty", value: (disk) => disk.warrantyDaysLeft },
  {
    id: "pin33",
    label: "3.3 V",
    value: (disk) => (disk.inventory.pin33Taped ? 1 : 0),
  },
];

const compareValues = (a: string | number, b: string | number) =>
  typeof a === "number" && typeof b === "number"
    ? a - b
    : String(a).localeCompare(String(b), undefined, { numeric: true });

export function sortDisks(
  disks: InventoryDisk[],
  sorting: SortingState,
): InventoryDisk[] {
  const [primary] = sorting;
  const field = SORT_FIELDS.find(({ id }) => id === primary?.id);
  if (!primary || !field) return disks;
  const direction = primary.desc ? -1 : 1;
  return [...disks].sort((left, right) => {
    const a = field.value(left);
    const b = field.value(right);
    if (a === null) return b === null ? 0 : 1;
    if (b === null) return -1;
    return compareValues(a, b) * direction;
  });
}
