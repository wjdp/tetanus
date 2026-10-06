import type { IngestMeta, Parser } from "#shared/ingest";
import type {
  AtaAttribute,
  ScsiInfo,
  SctTemperatureHistory,
  SelfTestEntry,
  SmartctlExitFlags,
  SmartctlXallDevice,
  SmartctlXallIdentity,
  SmartctlXallResult,
} from "#shared/smartctl";
import { extractDeviceStatistics } from "./deviceStatistics";
import { ParseError } from "./parseError";
import { extractSeagateFarm } from "./seagateFarm";

export type {
  AtaAttribute,
  AtaAttributeFlags,
  ScsiErrorCounters,
  ScsiInfo,
  SctTemperatureHistory,
  SeagateFarm,
  SeagateFarmHead,
  SelfTestEntry,
  SmartctlExitFlags,
  SmartctlXallDevice,
  SmartctlXallIdentity,
  SmartctlXallResult,
} from "#shared/smartctl";

type Json = Record<string, unknown>;

function parseJson(body: string): Json {
  if (body.trim() === "") throw new ParseError("Empty smartctl-xall body");
  let json: unknown;
  try {
    json = JSON.parse(body);
  } catch {
    throw new ParseError("smartctl-xall body is not valid JSON");
  }
  if (typeof json !== "object" || json === null) {
    throw new ParseError("smartctl-xall body is not a JSON object");
  }
  return json as Json;
}

function decodeExitFlags(raw: number): SmartctlExitFlags {
  const bit = (n: number) => (raw & (1 << n)) !== 0;
  return {
    raw,
    commandLineError: bit(0),
    deviceOpenFailed: bit(1),
    commandFailed: bit(2),
    diskFailing: bit(3),
    prefailBelowThreshold: bit(4),
    pastPrefailBelowThreshold: bit(5),
    errorLogHasErrors: bit(6),
    selfTestLogHasErrors: bit(7),
  };
}

function resolveExitStatus(json: Json, meta: IngestMeta): number {
  if (typeof meta.exitStatus === "number") return meta.exitStatus;
  const smartctl = json.smartctl as Json | undefined;
  const fallback = smartctl?.exit_status;
  return typeof fallback === "number" ? fallback : 0;
}

function reassembleWwn(raw: unknown): string | undefined {
  if (typeof raw !== "object" || raw === null) return undefined;
  const wwn = raw as Json;
  const { naa, oui, id } = wwn;
  if (
    typeof naa !== "number" ||
    typeof oui !== "number" ||
    typeof id !== "number"
  ) {
    return undefined;
  }
  return `${naa.toString(16)}${oui.toString(16).padStart(6, "0")}${id.toString(16).padStart(9, "0")}`;
}

function parseSmartSupport(raw: unknown): {
  available: boolean;
  enabled: boolean;
} {
  if (typeof raw === "boolean") return { available: raw, enabled: raw };
  if (typeof raw === "object" && raw !== null) {
    const obj = raw as Json;
    const available = Boolean(obj.available);
    const enabled = typeof obj.enabled === "boolean" ? obj.enabled : available;
    return { available, enabled };
  }
  return { available: false, enabled: false };
}

function hasSmartData(json: Json): boolean {
  if (json.ata_smart_attributes || json.nvme_smart_health_information_log) {
    return true;
  }
  return Object.keys(json).some((key) => key.startsWith("scsi_"));
}

function toCamel(key: string): string {
  return key.replace(/_([a-z0-9])/g, (_, char) => char.toUpperCase());
}

function camelCaseShallow(obj: Json): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) out[toCamel(key)] = value;
  return out;
}

function extractAtaAttributes(json: Json): AtaAttribute[] | undefined {
  const attributes = json.ata_smart_attributes as Json | undefined;
  const table = attributes?.table;
  if (!Array.isArray(table)) return undefined;
  return table.map((entry) => {
    const row = entry as Json;
    const raw = (row.raw as Json | undefined) ?? {};
    const flags = (row.flags as Json | undefined) ?? {};
    const whenFailed = row.when_failed;
    return {
      id: row.id as number,
      name: row.name as string,
      value: row.value as number,
      worst: row.worst as number,
      thresh: row.thresh as number,
      whenFailed:
        typeof whenFailed === "string" && whenFailed !== "" ? whenFailed : null,
      raw: {
        value: raw.value as number | undefined,
        string: raw.string as string | undefined,
      },
      flags: {
        value: flags.value as number | undefined,
        string: flags.string as string | undefined,
        prefailure: Boolean(flags.prefailure),
        updatedOnline: Boolean(flags.updated_online),
        performance: Boolean(flags.performance),
        errorRate: Boolean(flags.error_rate),
        eventCount: Boolean(flags.event_count),
        autoKeep: Boolean(flags.auto_keep),
      },
    };
  });
}

function extractScsi(json: Json): ScsiInfo | undefined {
  if (!hasSmartData(json) && !json.scsi_error_counter_log) return undefined;
  const isScsi = Object.keys(json).some((key) => key.startsWith("scsi_"));
  if (!isScsi) return undefined;

  const scsi: ScsiInfo = {};
  if (typeof json.scsi_grown_defect_list === "number") {
    scsi.grownDefects = json.scsi_grown_defect_list;
  }
  const log = json.scsi_error_counter_log as Json | undefined;
  if (log) {
    for (const key of ["read", "write", "verify"] as const) {
      const entry = log[key] as Json | undefined;
      if (entry) {
        const count = (field: string) => entry[field] as number | undefined;
        scsi[key] = {
          correctedErrors: count("total_errors_corrected"),
          uncorrectedErrors: count("total_uncorrected_errors"),
          errorsCorrectedByEccfast: count("errors_corrected_by_eccfast"),
          errorsCorrectedByEccdelayed: count("errors_corrected_by_eccdelayed"),
          errorsCorrectedByRereadsRewrites: count(
            "errors_corrected_by_rereads_rewrites",
          ),
          totalErrorsCorrected: count("total_errors_corrected"),
          correctionAlgorithmInvocations: count(
            "correction_algorithm_invocations",
          ),
          totalUncorrectedErrors: count("total_uncorrected_errors"),
        };
      }
    }
  }
  if (json.scsi_start_stop_cycle_counter !== undefined) {
    scsi.startStopCycleCounter = json.scsi_start_stop_cycle_counter;
  }
  return scsi;
}

const NVME_SELF_TEST_FAILURES = new Set([5, 6, 7]);
const SCSI_SELF_TEST_FAILURES = new Set([3, 4, 5, 6, 7]);
const SCSI_SELF_TEST_KEY = /^scsi_self_test_\d+$/;

function extractSelfTests(json: Json): SelfTestEntry[] | undefined {
  const entries: SelfTestEntry[] = [];

  // `-x` reads the GP log (`extended`) and falls back to the SMART log (`standard`).
  const ataLog = json.ata_smart_self_test_log as Json | undefined;
  const ataTable = ((ataLog?.extended ?? ataLog?.standard) as Json | undefined)
    ?.table;
  if (Array.isArray(ataTable)) {
    for (const entry of ataTable) {
      const row = entry as Json;
      const type = row.type as Json | undefined;
      const status = row.status as Json | undefined;
      entries.push({
        type: type?.string as string | undefined,
        status: status?.string as string | undefined,
        passed: status?.passed !== false,
        lifetimeHours: row.lifetime_hours as number | undefined,
        ...(row.lba !== undefined ? { lba: row.lba as number } : {}),
      });
    }
  }

  const nvmeLog = json.nvme_self_test_log as Json | undefined;
  const nvmeTable = nvmeLog?.table;
  if (Array.isArray(nvmeTable)) {
    for (const entry of nvmeTable) {
      const row = entry as Json;
      const code = row.self_test_code as Json | undefined;
      const result = row.self_test_result as Json | undefined;
      entries.push({
        type: code?.string as string | undefined,
        status: result?.string as string | undefined,
        passed: !NVME_SELF_TEST_FAILURES.has(result?.value as number),
        lifetimeHours: row.power_on_hours as number | undefined,
        ...(row.lba !== undefined ? { lba: row.lba as number } : {}),
      });
    }
  }

  for (const [key, value] of Object.entries(json)) {
    if (!SCSI_SELF_TEST_KEY.test(key)) continue;
    const row = value as Json;
    const code = row.code as Json | undefined;
    const result = row.result as Json | undefined;
    const powerOnTime = row.power_on_time as Json | undefined;
    const lba = row.lba_first_failure as Json | number | undefined;
    const lbaValue = typeof lba === "number" ? lba : lba?.value;
    entries.push({
      type: code?.string as string | undefined,
      status: result?.string as string | undefined,
      passed: !SCSI_SELF_TEST_FAILURES.has(result?.value as number),
      lifetimeHours: powerOnTime?.hours as number | undefined,
      ...(typeof lbaValue === "number" ? { lba: lbaValue } : {}),
    });
  }

  return entries.length > 0 ? entries : undefined;
}

function extractSctTemperatureHistory(
  json: Json,
): SctTemperatureHistory | undefined {
  const history = json.ata_sct_temperature_history as Json | undefined;
  if (!history || !Array.isArray(history.table)) return undefined;
  return {
    intervalMinutes: history.logging_interval_minutes as number | undefined,
    values: history.table as (number | null)[],
  };
}

function stringField(raw: unknown): string | undefined {
  if (typeof raw !== "object" || raw === null) return undefined;
  const value = (raw as Json).string;
  return typeof value === "string" && value !== "" ? value : undefined;
}

function nameField(raw: unknown): string | undefined {
  if (typeof raw !== "object" || raw === null) return undefined;
  const value = (raw as Json).name;
  return typeof value === "string" && value !== "" ? value : undefined;
}

function bitsPerSecond(raw: unknown): number | undefined {
  if (typeof raw !== "object" || raw === null) return undefined;
  const { units_per_second: units, bits_per_unit: bits } = raw as Json;
  return typeof units === "number" && typeof bits === "number"
    ? units * bits
    : undefined;
}

function numberField(raw: unknown): number | undefined {
  return typeof raw === "number" ? raw : undefined;
}

function withoutUndefined<T extends object>(obj: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(obj).filter(([, value]) => value !== undefined),
  ) as Partial<T>;
}

function extractHardware(json: Json): Partial<SmartctlXallIdentity> {
  const interfaceSpeed = json.interface_speed as Json | undefined;
  const trim = json.trim as Json | undefined;
  return withoutUndefined({
    sataVersion: stringField(json.sata_version),
    ataVersion: stringField(json.ata_version),
    linkSpeedMaxBps: bitsPerSecond(interfaceSpeed?.max),
    linkSpeedCurrentBps: bitsPerSecond(interfaceSpeed?.current),
    trimSupported:
      typeof trim?.supported === "boolean" ? trim.supported : undefined,
    logicalBlockSize: numberField(json.logical_block_size),
    physicalBlockSize: numberField(json.physical_block_size),
    scsiTransport: nameField(json.scsi_transport_protocol),
    nvmeVersion: stringField(json.nvme_version),
  });
}

export const parse: Parser<SmartctlXallResult> = (body, meta) => {
  const json = parseJson(body);
  const exitStatusRaw = resolveExitStatus(json, meta);
  const flags = decodeExitFlags(exitStatusRaw);

  const smartctlJson = json.smartctl as Json | undefined;
  const version = Array.isArray(smartctlJson?.version)
    ? (smartctlJson.version as unknown[]).join(".")
    : "";

  const deviceJson = (json.device as Json | undefined) ?? {};
  const device: SmartctlXallDevice = {
    name: (deviceJson.name as string | undefined) ?? meta.device ?? "",
    type: (deviceJson.type as string | undefined) ?? meta.type ?? "",
    protocol: (deviceJson.protocol as string | undefined) ?? "",
  };

  const standby = flags.deviceOpenFailed && !hasSmartData(json);

  const identity: SmartctlXallIdentity = {};
  if (typeof json.model_name === "string") identity.model = json.model_name;
  if (typeof json.model_family === "string") {
    identity.modelFamily = json.model_family;
  }
  if (typeof json.serial_number === "string") {
    identity.serial = json.serial_number;
  }
  if (typeof json.firmware_version === "string") {
    identity.firmware = json.firmware_version;
  }
  const wwn = reassembleWwn(json.wwn);
  if (wwn) identity.wwn = wwn;
  const userCapacity = json.user_capacity as Json | undefined;
  const capacityBytes =
    (json.nvme_total_capacity as number | undefined) ??
    (userCapacity?.bytes as number | undefined);
  if (typeof capacityBytes === "number") identity.capacityBytes = capacityBytes;
  if (typeof json.rotation_rate === "number") {
    identity.rotationRate = json.rotation_rate;
  }
  const formFactor = json.form_factor as Json | undefined;
  if (typeof formFactor?.name === "string") {
    identity.formFactor = formFactor.name;
  }
  if (device.type) identity.deviceType = device.type;
  Object.assign(identity, extractHardware(json));

  const smartSupport = parseSmartSupport(json.smart_support);
  const smartStatus = json.smart_status as Json | undefined;

  const temperatureJson = json.temperature as Json | undefined;
  const powerOnTime = json.power_on_time as Json | undefined;

  const ataAttributes = extractAtaAttributes(json);
  const scsi = extractScsi(json);
  const nvmeLog = json.nvme_smart_health_information_log as Json | undefined;

  const data: SmartctlXallResult = {
    device,
    smartctl: { version, exitStatus: flags },
    identity,
    smartSupport,
    standby,
    ...(smartStatus
      ? { smartStatus: { passed: Boolean(smartStatus.passed) } }
      : {}),
    ...(typeof temperatureJson?.current === "number"
      ? { temperature: temperatureJson.current }
      : {}),
    ...(typeof powerOnTime?.hours === "number"
      ? { powerOnHours: powerOnTime.hours }
      : {}),
    ...(typeof json.power_cycle_count === "number"
      ? { powerCycles: json.power_cycle_count }
      : {}),
    ...(ataAttributes ? { ata: { attributes: ataAttributes } } : {}),
    ...(nvmeLog ? { nvme: camelCaseShallow(nvmeLog) } : {}),
    ...(scsi ? { scsi } : {}),
  };

  const selfTests = extractSelfTests(json);
  if (selfTests) data.selfTests = selfTests;
  const sctTemperatureHistory = extractSctTemperatureHistory(json);
  if (sctTemperatureHistory) data.sctTemperatureHistory = sctTemperatureHistory;
  const farm = extractSeagateFarm(json.seagate_farm_log);
  if (farm) data.farm = farm;
  const deviceStatistics = extractDeviceStatistics(json.ata_device_statistics);
  if (deviceStatistics) data.deviceStatistics = deviceStatistics;

  return {
    data,
    summary: {
      model: identity.model ?? "",
      serial: identity.serial ?? "",
      protocol: device.protocol,
      exitStatus: exitStatusRaw,
      standby: standby ? 1 : 0,
      attributes: ataAttributes?.length ?? 0,
    },
  };
};
