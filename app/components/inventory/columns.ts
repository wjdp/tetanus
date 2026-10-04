import type { DiskFaultCounts } from "#shared/faults";
import { interfaceLabel, sectorFormat } from "#shared/hardware";
import { moneyPerTb, moneyPerTbLabel } from "#shared/money";
import { usageShort } from "#shared/usage";
import { markdownToPlainText } from "~/utils/markdown";
import type { InventoryDisk, InventoryMembership, SortingState } from "./types";

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
  currencyLabel?: (currency: string) => string;
  group: ColumnGroup;
  value: (disk: InventoryDisk) => SortValue;
  defaultVisible: boolean;
  locked?: boolean;
}

export const columnLabel = (column: InventoryColumn, currency: string) =>
  column.currencyLabel?.(currency) ?? column.label;

export interface VdevPlacement {
  type: string;
  label: string;
}

export function vdevPlacement(
  membership: InventoryMembership | null,
): VdevPlacement | null {
  if (!membership) return null;
  const { groupType, groupName, vdevName } = membership;
  if (groupType === "root") return { type: "disk", label: "stripe" };
  return { type: groupType ?? "disk", label: groupName ?? vdevName };
}

const MAX_FAULTS_PER_BUCKET = 999;
const FAULT_BUCKET_WEIGHT = MAX_FAULTS_PER_BUCKET + 1;

export function faultRank({
  error,
  warning,
  acknowledged,
}: DiskFaultCounts): number | null {
  if (error + warning + acknowledged === 0) return null;
  const capped = (count: number) => Math.min(count, MAX_FAULTS_PER_BUCKET);
  return (
    (capped(error) * FAULT_BUCKET_WEIGHT + capped(warning)) *
      FAULT_BUCKET_WEIGHT +
    capped(acknowledged)
  );
}

const timestamp = (value: string | null | undefined) =>
  value ? Date.parse(value) : null;

const blankToNull = (value: string | null | undefined) =>
  value?.trim() ? value : null;

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
    id: "serial",
    label: "Serial",
    group: "Identity",
    value: (disk) => disk.serial,
    defaultVisible: false,
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
    id: "line",
    label: "Line",
    group: "Identity",
    value: (disk) => disk.specs?.line ?? null,
    defaultVisible: false,
  },
  {
    id: "firmware",
    label: "Firmware",
    group: "Identity",
    value: (disk) => disk.firmware,
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
    id: "formFactor",
    label: "Form factor",
    group: "Hardware",
    value: (disk) => disk.formFactor,
    defaultVisible: false,
  },
  {
    id: "trim",
    label: "TRIM",
    group: "Hardware",
    value: (disk) =>
      disk.trimSupported === null ? null : Number(disk.trimSupported),
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
    id: "device",
    label: "Device",
    group: "Placement",
    value: (disk) => disk.lastDevicePath,
    defaultVisible: false,
  },
  {
    id: "bay",
    label: "Bay",
    group: "Placement",
    value: (disk) =>
      disk.bay ? (disk.bay.label ?? disk.bay.defaultLabel) : null,
    defaultVisible: false,
  },
  {
    id: "storedAt",
    label: "Stored at",
    group: "Placement",
    value: (disk) => blankToNull(disk.inventory.storageLocation),
    defaultVisible: false,
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
    value: (disk) => usageShort(disk.usage),
    defaultVisible: false,
  },
  {
    id: "vdev",
    label: "Vdev",
    group: "Placement",
    value: (disk) => vdevPlacement(disk.membership)?.label ?? null,
    defaultVisible: false,
  },
  {
    id: "vdevState",
    label: "ZFS state",
    group: "Health",
    value: (disk) => disk.membership?.vdevState ?? null,
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
    id: "faults",
    label: "Faults",
    group: "Health",
    value: (disk) => faultRank(disk.faultCounts),
    defaultVisible: false,
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
    id: "powerCycles",
    label: "Power cycles",
    group: "Health",
    value: (disk) => disk.latestPowerCycles,
    defaultVisible: false,
  },
  {
    id: "lastReading",
    label: "Last reading",
    group: "Health",
    value: (disk) => timestamp(disk.latestReadingAt),
    defaultVisible: false,
  },
  {
    id: "reallocated",
    label: "Reallocated",
    group: "Health",
    value: (disk) => disk.counters.reallocated?.value ?? null,
    defaultVisible: false,
  },
  {
    id: "pending",
    label: "Pending",
    group: "Health",
    value: (disk) => disk.counters.pending?.value ?? null,
    defaultVisible: false,
  },
  {
    id: "uncorrectable",
    label: "Uncorrectable",
    group: "Health",
    value: (disk) => disk.counters.uncorrectable?.value ?? null,
    defaultVisible: false,
  },
  {
    id: "wear",
    label: "Wear",
    group: "Health",
    value: (disk) => disk.counters.wearPercent?.value ?? null,
    defaultVisible: false,
  },
  {
    id: "written",
    label: "Written",
    group: "Health",
    value: (disk) => disk.counters.bytesWritten,
    defaultVisible: false,
  },
  {
    id: "firstSeen",
    label: "First seen",
    group: "Identity",
    value: (disk) => timestamp(disk.firstSeenAt),
    defaultVisible: false,
  },
  {
    id: "age",
    label: "Age",
    group: "Inventory",
    value: (disk) => disk.ageDays,
    defaultVisible: false,
  },
  {
    id: "purchased",
    label: "Purchased",
    group: "Inventory",
    value: (disk) => timestamp(disk.inventory.purchaseDate),
    defaultVisible: false,
  },
  {
    id: "price",
    label: "Price",
    group: "Inventory",
    value: (disk) => disk.inventory.purchasePrice ?? null,
    defaultVisible: false,
  },
  {
    id: "pricePerTb",
    label: "Price/TB",
    currencyLabel: moneyPerTbLabel,
    group: "Inventory",
    value: (disk) =>
      moneyPerTb(disk.inventory.purchasePrice ?? null, disk.capacityBytes),
    defaultVisible: false,
  },
  {
    id: "supplier",
    label: "Supplier",
    group: "Inventory",
    value: (disk) => blankToNull(disk.inventory.supplier),
    defaultVisible: false,
  },
  {
    id: "condition",
    label: "Condition",
    group: "Inventory",
    value: (disk) => disk.inventory.purchaseCondition ?? null,
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
    id: "orderRef",
    label: "Order ref",
    group: "Inventory",
    value: (disk) => blankToNull(disk.inventory.orderRef),
    defaultVisible: false,
  },
  {
    id: "shuckedFrom",
    label: "Shucked from",
    group: "Inventory",
    value: (disk) => blankToNull(disk.inventory.shuckedFrom),
    defaultVisible: false,
  },
  {
    id: "tags",
    label: "Tags",
    group: "Inventory",
    value: (disk) => disk.inventory.tags?.join(", ") || null,
    defaultVisible: false,
  },
  {
    id: "bpid",
    label: "BPID",
    group: "Inventory",
    value: (disk) => blankToNull(disk.inventory.seagateBpid),
    defaultVisible: false,
  },
  {
    id: "pin33",
    label: "3.3 V",
    group: "Inventory",
    value: (disk) => (disk.inventory.pin33Taped ? 1 : null),
    defaultVisible: false,
  },
  {
    id: "notes",
    label: "Notes",
    group: "Inventory",
    value: (disk) => blankToNull(markdownToPlainText(disk.notes)),
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
