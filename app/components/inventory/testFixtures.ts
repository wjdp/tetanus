import { NO_DISK_FAULTS } from "#shared/faults";
import { NO_COUNTERS } from "#shared/smart/counters";
import { TEMPERATURE_DEFAULTS } from "#shared/temperature";
import { UNKNOWN_USAGE } from "#shared/usage";
import type { InventoryDisk, InventoryMembership } from "./types";

export const emptyInventoryDisk = (
  overrides: Partial<InventoryDisk> = {},
): InventoryDisk => ({
  id: 1,
  alias: null,
  model: null,
  modelShort: null,
  serial: null,
  firmware: null,
  capacityBytes: null,
  hostName: null,
  lastDevicePath: null,
  bay: null,
  present: true,
  state: "in-use",
  stateOverride: null,
  stateAsOf: null,
  latestStatus: "passed",
  latestTemp: null,
  tempThresholds: TEMPERATURE_DEFAULTS.hdd,
  latestPowerOnHours: null,
  latestPowerCycles: null,
  latestReadingAt: null,
  firstSeenAt: null,
  ageDays: null,
  warrantyDaysLeft: null,
  inventory: {},
  notes: "",
  membership: null,
  usage: UNKNOWN_USAGE,
  purpose: null,
  purposeInferred: false,
  vendor: null,
  media: null,
  rotationRate: null,
  formFactor: null,
  trimSupported: null,
  interface: null,
  link: null,
  recordingTech: null,
  specs: null,
  logicalBlockSize: null,
  physicalBlockSize: null,
  hardware: null,
  counters: NO_COUNTERS,
  faultCounts: NO_DISK_FAULTS,
  disposal: null,
  replacedByDiskId: null,
  ...overrides,
});

export const mirrorMembership = (
  overrides: Partial<InventoryMembership> = {},
): InventoryMembership => ({
  poolId: 1,
  poolName: "tank",
  poolPath: "/zfs/nas1/tank",
  vdevName: "/dev/disk/by-id/ata-K1",
  groupName: "mirror-0",
  groupType: "mirror",
  vdevState: "ONLINE",
  ...overrides,
});
