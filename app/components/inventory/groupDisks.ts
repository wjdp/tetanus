import type { EffectiveDiskState } from "#shared/disk";
import { interfaceLabel } from "#shared/hardware";
import { LIFECYCLE_VOCABULARY } from "~/utils/vocabulary";
import { sortDisks } from "./columns";
import type { InventoryDisk, SortingState } from "./types";

export const GROUP_BY_OPTIONS = [
  "host",
  "pool",
  "vendor",
  "line",
  "media",
  "interface",
  "purpose",
  "state",
] as const;

export type GroupBy = (typeof GROUP_BY_OPTIONS)[number];

interface Grouper {
  label: string;
  blank: string;
  key: (disk: InventoryDisk) => string | null;
  name: (key: string) => string;
}

const asIs = (key: string) => key;

const knownOrNull = <Value extends string>(value: Value | null) =>
  value === "unknown" ? null : value;

const GROUPERS: Record<GroupBy, Grouper> = {
  host: {
    label: "Host",
    blank: "No host",
    key: (disk) => disk.hostName,
    name: asIs,
  },
  pool: {
    label: "Pool",
    blank: "No pool",
    key: (disk) => disk.membership?.poolName ?? null,
    name: asIs,
  },
  vendor: {
    label: "Vendor",
    blank: "Unknown vendor",
    key: (disk) => disk.vendor,
    name: (key) => vendorLabel(key as InventoryDisk["vendor"]) ?? key,
  },
  line: {
    label: "Line",
    blank: "Unknown line",
    key: (disk) => disk.specs?.line ?? null,
    name: asIs,
  },
  media: {
    label: "Media",
    blank: "Unknown media",
    key: (disk) => knownOrNull(disk.media),
    name: (key) => key.toUpperCase(),
  },
  interface: {
    label: "Interface",
    blank: "Unknown interface",
    key: (disk) => knownOrNull(disk.interface),
    name: (key) =>
      interfaceLabel(key as InventoryDisk["interface"], null) ?? key,
  },
  purpose: {
    label: "Purpose",
    blank: "No purpose",
    key: (disk) => disk.purpose,
    name: asIs,
  },
  state: {
    label: "State",
    blank: "Unknown state",
    key: (disk) => disk.state,
    name: (key) => LIFECYCLE_VOCABULARY[key as EffectiveDiskState].label,
  },
};

export const groupByLabel = (groupBy: GroupBy) => GROUPERS[groupBy].label;

export interface DiskGroup {
  key: string;
  label: string;
  disks: InventoryDisk[];
  capacityBytes: number;
  spend: number | null;
}

const BLANK_KEY = "";

const sum = (values: (number | null | undefined)[]) =>
  values.reduce<number>((total, value) => total + (value ?? 0), 0);

function summarise(
  key: string,
  label: string,
  disks: InventoryDisk[],
): DiskGroup {
  const prices = disks.map((disk) => disk.inventory.purchasePrice);
  return {
    key,
    label,
    disks,
    capacityBytes: sum(disks.map((disk) => disk.capacityBytes)),
    spend: prices.some((price) => price != null) ? sum(prices) : null,
  };
}

export function groupDisks(
  disks: InventoryDisk[],
  groupBy: GroupBy,
  sorting: SortingState,
): DiskGroup[] {
  const grouper = GROUPERS[groupBy];
  const byKey = new Map<string, InventoryDisk[]>();
  for (const disk of sortDisks(disks, sorting)) {
    const key = grouper.key(disk) || BLANK_KEY;
    byKey.set(key, [...(byKey.get(key) ?? []), disk]);
  }
  return [...byKey]
    .map(([key, members]) =>
      summarise(
        key,
        key === BLANK_KEY ? grouper.blank : grouper.name(key),
        members,
      ),
    )
    .sort((left, right) => {
      if (left.key === BLANK_KEY) return right.key === BLANK_KEY ? 0 : 1;
      if (right.key === BLANK_KEY) return -1;
      return left.label.localeCompare(right.label, undefined, {
        numeric: true,
      });
    });
}
