import { eq } from "drizzle-orm";
import type { DeviceStatistics } from "#shared/smart/deviceStatistics";
import type { SeagateFarm } from "#shared/smartctl";
import { db } from "~~/server/database/client";
import { disk } from "~~/server/database/schema";
import { attributesOfReading, latestReading } from "~~/server/services/smart";
import { notFound } from "~~/server/utils/serviceError";

/** NVMe health-log lifetime figures, from the latest reading's attributes. */
export interface NvmeStatistics {
  dataUnitsRead?: number;
  dataUnitsWritten?: number;
  hostReads?: number;
  hostWrites?: number;
  controllerBusyMinutes?: number;
  powerCycles?: number;
  unsafeShutdowns?: number;
  mediaErrors?: number;
  errorLogEntries?: number;
  warningTemperatureMinutes?: number;
  criticalTemperatureMinutes?: number;
}

const NVME_ATTRIBUTES: Record<string, keyof NvmeStatistics> = {
  data_units_read: "dataUnitsRead",
  data_units_written: "dataUnitsWritten",
  host_reads: "hostReads",
  host_writes: "hostWrites",
  controller_busy_time: "controllerBusyMinutes",
  power_cycles: "powerCycles",
  unsafe_shutdowns: "unsafeShutdowns",
  media_errors: "mediaErrors",
  num_err_log_entries: "errorLogEntries",
  warning_temp_time: "warningTemperatureMinutes",
  critical_comp_time: "criticalTemperatureMinutes",
};

export interface DiskStatistics {
  device: DeviceStatistics | null;
  nvme: NvmeStatistics | null;
  farm: SeagateFarm | null;
  smartPowerOnHours: number | null;
  logicalBlockSize: number | null;
}

function nvmeStatistics(diskId: number): NvmeStatistics | null {
  const reading = latestReading(diskId);
  if (!reading) return null;
  const statistics: NvmeStatistics = {};
  for (const attribute of attributesOfReading(reading.id)) {
    const field = NVME_ATTRIBUTES[attribute.attrId];
    if (field) statistics[field] = attribute.transformedValue;
  }
  return Object.keys(statistics).length ? statistics : null;
}

export function getDiskStatistics(diskId: number): DiskStatistics {
  const row = db
    .select({
      protocol: disk.protocol,
      latestDeviceStatistics: disk.latestDeviceStatistics,
      latestFarm: disk.latestFarm,
      latestPowerOnHours: disk.latestPowerOnHours,
      logicalBlockSize: disk.logicalBlockSize,
    })
    .from(disk)
    .where(eq(disk.id, diskId))
    .get();
  if (!row) throw notFound(`Disk ${diskId} not found`);
  return {
    device: row.latestDeviceStatistics,
    nvme: row.protocol === "nvme" ? nvmeStatistics(diskId) : null,
    farm: row.latestFarm,
    smartPowerOnHours: row.latestPowerOnHours,
    logicalBlockSize: row.logicalBlockSize,
  };
}
