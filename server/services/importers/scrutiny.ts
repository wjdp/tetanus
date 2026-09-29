import { and, asc, eq, isNotNull } from "drizzle-orm";
import type { DiskKey, DiskProtocol } from "#shared/disk";
import { classifyMedia, type Media } from "#shared/hardware";
import type {
  ScrutinyDeviceImport,
  ScrutinyImportResult,
  ScrutinyMatch,
} from "#shared/schemas/import";
import type { SmartProtocol } from "#shared/smart/metadata";
import { db } from "~~/server/database/client";
import {
  disk,
  diskKey,
  host,
  smartReading,
  temperatureReading,
} from "~~/server/database/schema";
import { addAutoEvent } from "~~/server/services/diary";
import { type DiskRow, findDiskByKey } from "~~/server/services/disks";
import { deriveHardware } from "~~/server/services/hardware";
import {
  normaliseModelSerial,
  normaliseWwn,
} from "~~/server/services/identity";
import {
  createScrutinyClient,
  type FetchImpl,
  type ScrutinyDetails,
  type ScrutinyDevice,
  type ScrutinySmartPoint,
  type ScrutinyTemperaturePoint,
  scrutinyDeviceKey,
} from "~~/server/services/importers/scrutinyApi";
import {
  evaluateMinimalReading,
  insertSmartReading,
  insertTemperatures,
  type MinimalSmartReading,
  type TemperaturePoint,
} from "~~/server/services/smart";
import { notFound } from "~~/server/utils/serviceError";

export type { ScrutinyDeviceImport, ScrutinyImportResult, ScrutinyMatch };

export interface ImportScrutinyOptions {
  url: string;
  hostId: number;
  dryRun: boolean;
  fetchImpl?: FetchImpl;
  onProgress?: (done: number, total: number) => void;
}

interface DiskMatch {
  diskId: number;
  matched: Exclude<ScrutinyMatch, "created">;
  scrutinyUuid: string | null;
}

const SCRUTINY_WWN = /^0x[0-9a-f]+$/i;
const SMART_PROTOCOLS: readonly SmartProtocol[] = ["ATA", "NVMe", "SCSI"];
const DISK_PROTOCOLS: Record<string, DiskProtocol> = {
  ata: "ata",
  nvme: "nvme",
  scsi: "scsi",
};

function scrutinyWwn(device: ScrutinyDevice): string | null {
  return SCRUTINY_WWN.test(device.wwn) ? normaliseWwn(device.wwn) : null;
}

function comparable(value: string | null) {
  return (value ?? "").trim().replace(/\s+/g, " ").toLowerCase();
}

function findByModelSerial(device: ScrutinyDevice) {
  const byKey = findDiskByKey(
    "model-serial",
    `${device.model_name}|${device.serial_number}`,
  );
  if (byKey) return byKey;
  const model = comparable(device.model_name);
  const serial = comparable(device.serial_number);
  return db
    .select()
    .from(disk)
    .where(and(isNotNull(disk.model), isNotNull(disk.serial)))
    .orderBy(asc(disk.id))
    .all()
    .find(
      (row) =>
        comparable(row.model) === model && comparable(row.serial) === serial,
    );
}

function findByScrutinyUuid(uuid: string) {
  if (uuid === "") return undefined;
  return db.select().from(disk).where(eq(disk.scrutinyUuid, uuid)).get();
}

function matchDisk(device: ScrutinyDevice): DiskMatch | null {
  const wwn = scrutinyWwn(device);
  const candidates: [DiskMatch["matched"], () => DiskRow | undefined][] = [
    ["wwn", () => (wwn ? findDiskByKey("wwn", wwn) : undefined)],
    ["uuid", () => findByScrutinyUuid(device.scrutiny_uuid)],
    [
      "serial",
      () =>
        device.model_name && device.serial_number
          ? findByModelSerial(device)
          : undefined,
    ],
  ];
  for (const [matched, find] of candidates) {
    const row = find();
    if (row) return { diskId: row.id, matched, scrutinyUuid: row.scrutinyUuid };
  }
  return null;
}

function earliest(diskId: number): Date | null {
  const reading = db
    .select({ at: smartReading.takenAt })
    .from(smartReading)
    .where(eq(smartReading.diskId, diskId))
    .orderBy(asc(smartReading.takenAt))
    .limit(1)
    .get()?.at;
  const temperature = db
    .select({ at: temperatureReading.at })
    .from(temperatureReading)
    .where(eq(temperatureReading.diskId, diskId))
    .orderBy(asc(temperatureReading.at))
    .limit(1)
    .get()?.at;
  const times = [reading, temperature].filter((at) => at !== undefined);
  if (times.length === 0) return null;
  return new Date(Math.min(...times.map((at) => at.getTime())));
}

function isBefore(cutoff: Date | null, at: Date) {
  return cutoff === null || at < cutoff;
}

function smartProtocol(protocol: string): SmartProtocol | undefined {
  return SMART_PROTOCOLS.find((known) => known === protocol);
}

function minimalReading(
  point: ScrutinySmartPoint,
  protocol: SmartProtocol | undefined,
): MinimalSmartReading | null {
  if (!protocol) return null;
  return {
    protocol,
    attributes: Object.entries(point.attrs).map(([id, attribute]) => ({
      id,
      value: attribute.value,
      worst: attribute.worst,
      thresh: attribute.thresh,
      rawValue: attribute.raw_value,
      rawString: attribute.raw_string,
      whenFailed: attribute.when_failed,
    })),
    temperature: point.temp,
    powerOnHours: point.power_on_hours,
    powerCycles: point.power_cycle_count,
  };
}

function uniqueTemperatures(
  points: ScrutinyTemperaturePoint[],
  cutoff: Date | null,
): TemperaturePoint[] {
  const byTime = new Map<number, TemperaturePoint>();
  for (const { date, temp } of points) {
    if (temp <= 0 || !isBefore(cutoff, date) || byTime.has(date.getTime())) {
      continue;
    }
    byTime.set(date.getTime(), { at: date, celsius: temp });
  }
  return [...byTime.values()].sort((a, b) => a.at.getTime() - b.at.getTime());
}

function devicePath(device: ScrutinyDevice) {
  const name = device.device_name;
  return name === "" || name.startsWith("/") ? name : `/dev/${name}`;
}

function diskProtocol(protocol: string): DiskProtocol | null {
  if (protocol === "") return null;
  return DISK_PROTOCOLS[protocol.toLowerCase()] ?? "unknown";
}

function knownMedia(media: Media): Media | undefined {
  return media === "unknown" ? undefined : media;
}

function createInventoryDisk(device: ScrutinyDevice, hostId: number): number {
  const model = device.model_name || null;
  const rotationRate = device.rotational_speed ?? null;
  const formFactor = device.form_factor || null;
  const created = db
    .insert(disk)
    .values({
      model,
      serial: device.serial_number || null,
      firmware: device.firmware || null,
      capacityBytes: device.capacity || null,
      rotationRate,
      protocol: diskProtocol(device.device_protocol),
      link: device.interface_type || null,
      formFactor,
      ...deriveHardware(undefined, {
        model,
        rotationRate,
        formFactor,
        media: knownMedia(
          classifyMedia({
            rotationRate: device.rotational_speed,
            protocol: device.device_protocol,
          }),
        ),
        wwn: scrutinyWwn(device),
      }),
      scrutinyUuid: device.scrutiny_uuid || null,
      firstSeenAt: device.CreatedAt,
      lastSeenAt: device.UpdatedAt,
      lastSeenHostId: hostId,
      lastDevicePath: devicePath(device) || null,
      lastDeviceType: device.device_type || null,
    })
    .returning({ id: disk.id })
    .get();
  for (const key of inventoryKeys(device)) {
    db.insert(diskKey)
      .values({ diskId: created.id, ...key })
      .onConflictDoNothing()
      .run();
  }
  return created.id;
}

function inventoryKeys(device: ScrutinyDevice): DiskKey[] {
  const wwn = scrutinyWwn(device);
  const model = device.model_name.trim();
  const serial = device.serial_number.trim();
  return [
    ...(wwn ? [{ kind: "wwn" as const, value: wwn }] : []),
    ...(model && serial
      ? [
          {
            kind: "model-serial" as const,
            value: normaliseModelSerial(model, serial),
          },
        ]
      : []),
  ];
}

interface DevicePlan {
  device: ScrutinyDevice;
  match: DiskMatch | null;
  cutoff: Date | null;
  points: ScrutinySmartPoint[];
  temperatures: TemperaturePoint[];
  skipped: number;
}

function planDevice(
  device: ScrutinyDevice,
  details: ScrutinyDetails,
  temperatureHistory: ScrutinyTemperaturePoint[],
): DevicePlan {
  const match = matchDisk(device);
  const cutoff = match ? earliest(match.diskId) : null;
  const points = details.smart_results.filter((point) =>
    isBefore(cutoff, point.date),
  );
  const smartTemperatures = details.smart_results.flatMap((point) =>
    point.temp === null ? [] : [{ date: point.date, temp: point.temp }],
  );
  return {
    device,
    match,
    cutoff,
    points,
    temperatures: uniqueTemperatures(
      [...temperatureHistory, ...smartTemperatures],
      cutoff,
    ),
    skipped: details.smart_results.length - points.length,
  };
}

function writePlan(plan: DevicePlan, hostId: number, url: string): number {
  const { device, match, points, temperatures } = plan;
  return db.transaction(() => {
    const diskId = match?.diskId ?? createInventoryDisk(device, hostId);
    if (match && !match.scrutinyUuid && device.scrutiny_uuid) {
      db.update(disk)
        .set({ scrutinyUuid: device.scrutiny_uuid })
        .where(eq(disk.id, diskId))
        .run();
    }
    const protocol = smartProtocol(device.device_protocol);
    for (const point of points) {
      const minimal = minimalReading(
        point,
        smartProtocol(point.device_protocol) ?? protocol,
      );
      const evaluation = minimal
        ? evaluateMinimalReading(minimal)
        : { attributes: [], deviceStatus: "unknown" as const, temp: null };
      insertSmartReading(
        {
          diskId,
          hostId,
          takenAt: point.date,
          devicePath: devicePath(device),
          deviceType: device.device_type || null,
          smartPassed: null,
          exitStatus: null,
          temp: evaluation.temp,
          powerOnHours: point.power_on_hours,
          powerCycles: point.power_cycle_count,
          deviceStatus: evaluation.deviceStatus,
          source: "scrutiny",
        },
        evaluation.attributes,
      );
    }
    insertTemperatures(diskId, temperatures);
    addAutoEvent({
      subjectType: "disk",
      subjectId: diskId,
      eventType: "imported-from-scrutiny",
      title: `imported ${points.length} readings and ${temperatures.length} temperatures from scrutiny`,
      data: {
        url,
        key: scrutinyDeviceKey(device),
        matched: match?.matched ?? "created",
        readings: points.length,
        temperatures: temperatures.length,
        skipped: plan.skipped,
        cutoff: plan.cutoff?.toISOString() ?? null,
      },
    });
    return diskId;
  });
}

function hasWork(plan: DevicePlan) {
  return (
    plan.match === null ||
    plan.points.length > 0 ||
    plan.temperatures.length > 0
  );
}

function assertHostExists(hostId: number) {
  const found = db
    .select({ id: host.id })
    .from(host)
    .where(eq(host.id, hostId))
    .get();
  if (!found) throw notFound(`Host ${hostId} not found`);
}

function describeError(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export async function importScrutiny({
  url,
  hostId,
  dryRun,
  fetchImpl,
  onProgress,
}: ImportScrutinyOptions): Promise<ScrutinyImportResult> {
  assertHostExists(hostId);
  const client = createScrutinyClient(url, fetchImpl);
  const { summary } = await client.summary();
  const { temp_history: temperatureHistory } =
    await client.temperatureHistory();
  const entries = Object.entries(summary);
  const devices: ScrutinyDeviceImport[] = [];

  for (const [key, { device, temp_history: recent }] of entries) {
    const base = {
      key,
      model: device.model_name,
      serial: device.serial_number,
    };
    try {
      const details = await client.details(key);
      const plan = planDevice(device, details, [
        ...(temperatureHistory[key] ?? []),
        ...(recent ?? []),
      ]);
      const diskId =
        dryRun || !hasWork(plan)
          ? (plan.match?.diskId ?? null)
          : writePlan(plan, hostId, url);
      devices.push({
        ...base,
        matched: plan.match?.matched ?? "created",
        diskId,
        cutoff: plan.cutoff,
        readings: plan.points.length,
        temperatures: plan.temperatures.length,
        skipped: plan.skipped,
      });
    } catch (error) {
      const match = matchDisk(device);
      devices.push({
        ...base,
        matched: match?.matched ?? "created",
        diskId: match?.diskId ?? null,
        cutoff: null,
        readings: 0,
        temperatures: 0,
        skipped: 0,
        error: describeError(error),
      });
    }
    onProgress?.(devices.length, entries.length);
  }

  return { dryRun, devices };
}
