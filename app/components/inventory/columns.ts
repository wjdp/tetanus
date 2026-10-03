import { interfaceLabel, sectorFormat } from "#shared/hardware";
import { usageShort } from "#shared/usage";
import type { InventoryDisk, SortingState } from "./types";

type SortValue = string | number | null;

export const COLUMN_GROUPS = [
  "Identity",
  "Hardware",
  "Placement",
  "Health",
  "Inventory",
] as const;

export type ColumnGroup = (typeof COLUMN_GROUPS)[number];

export interface InventoryColumn {
  id: string;
  label: string;
  group: ColumnGroup;
  value: (disk: InventoryDisk) => SortValue;
  defaultVisible: boolean;
  locked?: boolean;
}

export const INVENTORY_COLUMNS: InventoryColumn[] = [
  {
    id: "alias",
    label: "Alias",
    group: "Identity",
    value: (disk) => disk.alias,
    defaultVisible: true,
    locked: true,
  },
  {
    id: "model",
    label: "Model",
    group: "Identity",
    value: (disk) => disk.model,
    defaultVisible: true,
  },
  {
    id: "capacity",
    label: "Capacity",
    group: "Hardware",
    value: (disk) => disk.capacityBytes,
    defaultVisible: true,
  },
  {
    id: "vendor",
    label: "Vendor",
    group: "Identity",
    value: (disk) => vendorLabel(disk.vendor),
    defaultVisible: false,
  },
  {
    id: "media",
    label: "Media",
    group: "Hardware",
    value: (disk) => mediaLabel(disk.media, disk.rotationRate),
    defaultVisible: true,
  },
  {
    id: "interface",
    label: "Interface",
    group: "Hardware",
    value: (disk) => interfaceLabel(disk.interface, disk.link),
    defaultVisible: false,
  },
  {
    id: "recording",
    label: "Recording",
    group: "Hardware",
    value: (disk) => knownRecordingTech(disk.recordingTech),
    defaultVisible: false,
  },
  {
    id: "sectors",
    label: "Sectors",
    group: "Hardware",
    value: (disk) =>
      sectorFormat(disk.logicalBlockSize, disk.physicalBlockSize),
    defaultVisible: false,
  },
  {
    id: "host",
    label: "Host",
    group: "Placement",
    value: (disk) => disk.hostName,
    defaultVisible: true,
  },
  {
    id: "pool",
    label: "Pool",
    group: "Placement",
    value: (disk) => disk.membership?.poolName ?? disk.purpose ?? null,
    defaultVisible: true,
  },
  {
    id: "usage",
    label: "Usage",
    group: "Placement",
    value: (disk) => usageShort(disk.usage, disk.membership?.poolName ?? null),
    defaultVisible: false,
  },
  {
    id: "state",
    label: "State",
    group: "Health",
    value: (disk) => disk.state,
    defaultVisible: true,
  },
  {
    id: "status",
    label: "Status",
    group: "Health",
    value: (disk) => disk.latestStatus,
    defaultVisible: true,
  },
  {
    id: "temp",
    label: "Temp",
    group: "Health",
    value: (disk) => disk.latestTemp,
    defaultVisible: true,
  },
  {
    id: "powerOn",
    label: "Power-on",
    group: "Health",
    value: (disk) => disk.latestPowerOnHours,
    defaultVisible: true,
  },
  {
    id: "age",
    label: "Age",
    group: "Inventory",
    value: (disk) => disk.ageDays,
    defaultVisible: false,
  },
  {
    id: "warranty",
    label: "Warranty",
    group: "Inventory",
    value: (disk) => disk.warrantyDaysLeft,
    defaultVisible: true,
  },
  {
    id: "pin33",
    label: "3.3 V",
    group: "Inventory",
    value: (disk) => (disk.inventory.pin33Taped ? 1 : null),
    defaultVisible: false,
  },
];

export const findColumn = (id: string | undefined) =>
  INVENTORY_COLUMNS.find((column) => column.id === id);

export const DEFAULT_VISIBLE_COLUMNS: ReadonlySet<string> = new Set(
  INVENTORY_COLUMNS.filter(({ defaultVisible }) => defaultVisible).map(
    ({ id }) => id,
  ),
);

const compareValues = (a: string | number, b: string | number) =>
  typeof a === "number" && typeof b === "number"
    ? a - b
    : String(a).localeCompare(String(b), undefined, { numeric: true });

export function sortDisks(
  disks: InventoryDisk[],
  sorting: SortingState,
): InventoryDisk[] {
  const [primary] = sorting;
  const column = findColumn(primary?.id);
  if (!primary || !column) return disks;
  const direction = primary.desc ? -1 : 1;
  return [...disks].sort((left, right) => {
    const a = column.value(left);
    const b = column.value(right);
    if (a === null) return b === null ? 0 : 1;
    if (b === null) return -1;
    return compareValues(a, b) * direction;
  });
}
