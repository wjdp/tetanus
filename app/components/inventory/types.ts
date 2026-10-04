import type { Bay } from "#shared/bays";
import type { Disposal, EffectiveDiskState, StateOverride } from "#shared/disk";
import type { DiskFaultCounts } from "#shared/faults";
import type {
  HardwareJson,
  Interface,
  Media,
  RecordingTech,
} from "#shared/hardware";
import type { Inventory } from "#shared/inventory-fields";
import type { DiskCounters } from "#shared/smart/counters";
import type { DeviceStatus } from "#shared/smart/status";
import {
  type TemperatureThresholds,
  temperatureColour,
} from "#shared/temperature";
import type { DiskUsage, Purpose } from "#shared/usage";
import type { Vendor } from "#shared/vendor";
import { formatDays } from "~/utils/format";
import { STATUS_TEXT_CLASS } from "~/utils/vocabulary";

export interface InventoryMembership {
  poolId: number;
  poolName: string;
  vdevName: string;
  groupName: string | null;
  groupType: string | null;
  vdevState: string;
}

export interface InventoryDisk {
  id: number;
  alias: string | null;
  model: string | null;
  serial: string | null;
  firmware: string | null;
  capacityBytes: number | null;
  hostName: string | null;
  lastDevicePath: string | null;
  bay: Bay | null;
  present: boolean;
  state: EffectiveDiskState;
  stateOverride: StateOverride | null;
  stateAsOf: string | null;
  latestStatus: DeviceStatus;
  latestTemp: number | null;
  tempThresholds: TemperatureThresholds;
  latestPowerOnHours: number | null;
  latestPowerCycles: number | null;
  latestReadingAt: string | null;
  firstSeenAt: string | null;
  ageDays: number | null;
  warrantyDaysLeft: number | null;
  inventory: Partial<Inventory>;
  notes: string;
  membership: InventoryMembership | null;
  usage: DiskUsage;
  purpose: Purpose | null;
  purposeInferred: boolean;
  vendor: Vendor | null;
  media: Media | null;
  rotationRate: number | null;
  formFactor: string | null;
  trimSupported: boolean | null;
  interface: Interface | null;
  link: string | null;
  recordingTech: RecordingTech | null;
  logicalBlockSize: number | null;
  physicalBlockSize: number | null;
  hardware: HardwareJson | null;
  counters: DiskCounters;
  faultCounts: DiskFaultCounts;
  disposal: Disposal | null;
  replacedByDiskId: number | null;
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
