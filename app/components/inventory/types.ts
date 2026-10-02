import type { EffectiveDiskState, StateOverride } from "#shared/disk";
import type {
  HardwareJson,
  Interface,
  Media,
  RecordingTech,
} from "#shared/hardware";
import type { Inventory } from "#shared/inventory-fields";
import type { DeviceStatus } from "#shared/smart/status";
import {
  type TemperatureThresholds,
  temperatureColour,
} from "#shared/temperature";
import type { DiskUsage, Purpose } from "#shared/usage";
import type { Vendor } from "#shared/vendor";
import { formatDays } from "~/utils/format";
import { STATUS_TEXT_CLASS } from "~/utils/vocabulary";

export interface InventoryDisk {
  id: number;
  alias: string | null;
  model: string | null;
  serial: string | null;
  capacityBytes: number | null;
  hostName: string | null;
  state: EffectiveDiskState;
  stateOverride: StateOverride | null;
  stateAsOf: string | null;
  latestStatus: DeviceStatus;
  latestTemp: number | null;
  tempThresholds: TemperatureThresholds;
  latestPowerOnHours: number | null;
  ageDays: number | null;
  warrantyDaysLeft: number | null;
  inventory: Partial<Inventory>;
  membership: { poolId: number; poolName: string } | null;
  usage: DiskUsage;
  purpose: Purpose | null;
  purposeInferred: boolean;
  vendor: Vendor | null;
  media: Media | null;
  rotationRate: number | null;
  interface: Interface | null;
  link: string | null;
  recordingTech: RecordingTech | null;
  logicalBlockSize: number | null;
  physicalBlockSize: number | null;
  hardware: HardwareJson | null;
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

export const temperatureClass = (disk: InventoryDisk) =>
  STATUS_TEXT_CLASS[temperatureColour(disk.latestTemp, disk.tempThresholds)];
