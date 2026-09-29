import type { EffectiveDiskState, StateOverride } from "#shared/disk";
import type { Inventory } from "#shared/inventory-fields";
import type { DeviceStatus } from "#shared/smart/status";
import type { DiskUsage, Purpose } from "#shared/usage";
import { formatDays } from "~/utils/format";

export interface InventoryDisk {
  id: number;
  alias: string | null;
  model: string | null;
  serial: string | null;
  capacityBytes: number | null;
  hostName: string | null;
  state: EffectiveDiskState;
  stateOverride: StateOverride | null;
  latestStatus: DeviceStatus;
  latestTemp: number | null;
  latestPowerOnHours: number | null;
  ageDays: number | null;
  warrantyDaysLeft: number | null;
  inventory: Partial<Inventory>;
  membership: { poolId: number; poolName: string } | null;
  usage: DiskUsage;
  purpose: Purpose | null;
  purposeInferred: boolean;
}

export type SortingState = { id: string; desc: boolean }[];

export const WARRANTY_WARNING_DAYS = 90;

export const warrantyClass = (days: number | null) => {
  if (days === null || days < 0) return "text-dimmed";
  if (days < WARRANTY_WARNING_DAYS) return "text-warning";
  return "";
};

export const warrantyLabel = (days: number | null) =>
  days !== null && days < 0 ? "expired" : formatDays(days);
