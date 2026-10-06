import { isAtaLifeRemainingAttribute } from "#shared/smart/ataSsdAttributes";
import {
  isAtaDefectAttribute,
  isAtaReservedSpaceAttribute,
  SPARE_WARNING_MARGIN,
} from "#shared/smart/ssdPolicy";
import type { StoredPayload } from "./payloads";

export const EXIT_BITS = {
  diskFailing: 1 << 3,
  selfTestLogHasErrors: 1 << 7,
} as const;

export const SMART_FAILED_EXIT_BIT = EXIT_BITS.diskFailing;

export interface AtaAttribute {
  id: number;
  name: string;
  value: number;
  worst: number;
  thresh: number;
  raw: { value: number; string: string };
}

type Json = Record<string, unknown>;

export function parseSmartctl(body: string): Json {
  return JSON.parse(body) as Json;
}

export function serialOf(body: string): string | null {
  try {
    const serial = parseSmartctl(body).serial_number;
    return typeof serial === "string" ? serial : null;
  } catch {
    return null;
  }
}

/** Returns a copy of the payload with its smartctl JSON passed through `edit`. */
export function editSmartctl(
  stored: StoredPayload,
  edit: (json: Json) => void,
): StoredPayload {
  const json = parseSmartctl(stored.body);
  edit(json);
  return { ...stored, body: JSON.stringify(json, null, 2) };
}

/** Raises exit status bits in both the posted meta and the body, as smartctl reports them in both. */
export function withExitBits(
  stored: StoredPayload,
  bits: number,
): StoredPayload {
  const edited = editSmartctl(stored, (json) => {
    const smartctl = json.smartctl as Json | undefined;
    if (smartctl) {
      smartctl.exit_status = (Number(smartctl.exit_status) || 0) | bits;
    }
  });
  return {
    ...edited,
    meta: { ...edited.meta, exitStatus: (edited.meta.exitStatus ?? 0) | bits },
  };
}

export function protocolOf(json: Json): string | undefined {
  const protocol = (json.device as Json | undefined)?.protocol;
  return typeof protocol === "string" ? protocol : undefined;
}

export function ataAttributes(json: Json): AtaAttribute[] {
  const table = (json.ata_smart_attributes as { table?: AtaAttribute[] })
    ?.table;
  return Array.isArray(table) ? table : [];
}

export function ataAttribute(json: Json, id: number): AtaAttribute | undefined {
  return ataAttributes(json).find((attribute) => attribute.id === id);
}

export function setAtaRaw(json: Json, id: number, raw: number) {
  const attribute = ataAttribute(json, id);
  if (!attribute) throw new Error(`No ATA attribute ${id}`);
  attribute.raw = { value: raw, string: String(raw) };
}

export function failHealth(stored: StoredPayload): StoredPayload {
  return withExitBits(
    editSmartctl(stored, (json) => {
      json.smart_status = { ...(json.smart_status as Json), passed: false };
    }),
    EXIT_BITS.diskFailing,
  );
}

export function nvmeHealthLog(json: Json): Json | undefined {
  return json.nvme_smart_health_information_log as Json | undefined;
}

function requireNvmeHealthLog(json: Json): Json {
  const log = nvmeHealthLog(json);
  if (!log) throw new Error("No NVMe health information log");
  return log;
}

export const NVME_CRITICAL_WARNINGS = [
  { bit: 1, label: "Available spare below threshold" },
  { bit: 2, label: "Temperature" },
  { bit: 4, label: "Reliability degraded" },
  { bit: 8, label: "Read-only" },
  { bit: 16, label: "Volatile memory backup failed" },
] as const;

const SPARE_BELOW_THRESHOLD_BIT = 1;

function dropSpareBelowThreshold(log: Json) {
  const threshold = Number(log.available_spare_threshold) || 10;
  if (Number(log.available_spare) >= threshold) {
    log.available_spare = Math.max(0, threshold - 1);
  }
}

/** smartctl fails the overall health assessment whenever any critical warning bit is set. */
export function setNvmeCriticalWarning(
  stored: StoredPayload,
  bits: number,
): StoredPayload {
  const edited = editSmartctl(stored, (json) => {
    const log = requireNvmeHealthLog(json);
    log.critical_warning = bits;
    if (bits & SPARE_BELOW_THRESHOLD_BIT) dropSpareBelowThreshold(log);
    json.smart_status = { passed: bits === 0, nvme: { value: bits } };
  });
  return bits === 0 ? edited : withExitBits(edited, EXIT_BITS.diskFailing);
}

export function setNvmeMediaErrors(json: Json, count: number) {
  requireNvmeHealthLog(json).media_errors = count;
}

function setDeviceStatistic(json: Json, name: string, value: number) {
  const statistics = json.ata_device_statistics as
    | { pages?: { table?: { name: string; value?: number }[] }[] }
    | undefined;
  for (const page of statistics?.pages ?? []) {
    for (const row of page.table ?? []) {
      if (row.name === name && row.value !== undefined) row.value = value;
    }
  }
}

const SPARE_HEADROOM = SPARE_WARNING_MARGIN / 2;

function ataReservedSpaceAttributes(json: Json): AtaAttribute[] {
  return ataAttributes(json).filter((attribute) =>
    isAtaReservedSpaceAttribute(attribute.name),
  );
}

export function supportsSpare(json: Json): boolean {
  return (
    typeof nvmeHealthLog(json)?.available_spare === "number" ||
    ataReservedSpaceAttributes(json).length > 0
  );
}

/** Leaves spare within the warning margin of its threshold, without crossing it. */
export function setSpareNearThreshold(json: Json) {
  const log = nvmeHealthLog(json);
  if (log) {
    const threshold = Number(log.available_spare_threshold) || 10;
    log.available_spare = threshold + SPARE_HEADROOM;
  }
  for (const attribute of ataReservedSpaceAttributes(json)) {
    attribute.value = Math.max(0, attribute.thresh) + SPARE_HEADROOM;
    attribute.worst = Math.min(attribute.worst, attribute.value);
  }
}

/** Intel packs a power-loss capacitor test into 175, so it never stands in for a defect count. */
const INTEL_POWER_LOSS_TEST_ATTRIBUTE = 175;

export function ataDefectAttribute(json: Json): AtaAttribute | undefined {
  return ataAttributes(json).find(
    (attribute) =>
      isAtaDefectAttribute(attribute.name) &&
      attribute.id !== INTEL_POWER_LOSS_TEST_ATTRIBUTE,
  );
}

export function ataWearAttributes(json: Json): AtaAttribute[] {
  return ataAttributes(json).filter((attribute) =>
    isAtaLifeRemainingAttribute(attribute.name),
  );
}

export function supportsWear(json: Json): boolean {
  return (
    typeof nvmeHealthLog(json)?.percentage_used === "number" ||
    ataWearAttributes(json).length > 0
  );
}

export function setWear(json: Json, percentageUsed: number) {
  const log = nvmeHealthLog(json);
  if (log) log.percentage_used = percentageUsed;
  const remaining = Math.max(0, 100 - percentageUsed);
  for (const attribute of ataWearAttributes(json)) {
    attribute.value = remaining;
    attribute.worst = Math.min(attribute.worst, attribute.value);
    if (attribute.name === "Percent_Life_Remaining") {
      attribute.raw = { value: remaining, string: String(remaining) };
    }
  }
  setDeviceStatistic(
    json,
    "Percentage Used Endurance Indicator",
    percentageUsed,
  );
}

const TEMPERATURE_ATTRIBUTE_IDS = [190, 194];

function setTemperatureAttribute(attribute: AtaAttribute, celsius: number) {
  const current = attribute.raw.value % 256;
  attribute.raw = {
    value: attribute.raw.value - current + celsius,
    string: attribute.raw.string.replace(/^\d+/, String(celsius)),
  };
  if (attribute.value + current === 100) attribute.value = 100 - celsius;
  else if (attribute.value === current) attribute.value = celsius;
  attribute.worst = Math.min(attribute.worst, attribute.value);
}

export function setTemperature(json: Json, celsius: number) {
  json.temperature = { ...(json.temperature as Json), current: celsius };
  for (const id of TEMPERATURE_ATTRIBUTE_IDS) {
    const attribute = ataAttribute(json, id);
    if (attribute) setTemperatureAttribute(attribute, celsius);
  }
  const log = nvmeHealthLog(json);
  if (log) log.temperature = celsius;
  const history = json.ata_sct_temperature_history as
    | { temperature?: Json; table?: (number | null)[] }
    | undefined;
  if (history?.temperature) history.temperature.current = celsius;
  if (history?.table?.length) history.table[history.table.length - 1] = celsius;
  setDeviceStatistic(json, "Current Temperature", celsius);
}

export function capacityBlocks(json: Json): number | undefined {
  const blocks = (json.user_capacity as Json | undefined)?.blocks;
  if (typeof blocks === "number") return blocks;
  const bytes = json.nvme_total_capacity;
  const blockSize = json.logical_block_size;
  return typeof bytes === "number" && typeof blockSize === "number"
    ? Math.floor(bytes / blockSize)
    : undefined;
}

function fnv1a(text: string): number {
  let hash = 0x811c9dc5;
  for (const char of text) {
    hash = Math.imul(hash ^ (char.codePointAt(0) ?? 0), 0x01000193) >>> 0;
  }
  return hash;
}

/** A stable LBA somewhere on the disk, so the default does not change between menu opens. */
export function defaultFailingLba(json: Json): number {
  const blocks = capacityBlocks(json) ?? 2 ** 32;
  const seed = String(json.serial_number ?? "");
  return Math.floor((fnv1a(seed) / 2 ** 32) * blocks);
}

export const SELF_TEST_TYPES = ["short", "extended"] as const;
export type SelfTestType = (typeof SELF_TEST_TYPES)[number];

export function hasSelfTestLog(json: Json): boolean {
  return (
    json.ata_smart_self_test_log !== undefined ||
    json.nvme_self_test_log !== undefined
  );
}

function powerOnHours(json: Json): number {
  const hours = (json.power_on_time as Json | undefined)?.hours;
  return typeof hours === "number" ? hours : 0;
}

const ATA_SELF_TEST_NAMES: Record<SelfTestType, string> = {
  short: "Short offline",
  extended: "Extended offline",
};

const ATA_READ_FAILURE_STATUS = {
  value: 0x79,
  string: "Completed: read failure",
  remaining_percent: 90,
  passed: false,
};

function addFailedAtaSelfTest(json: Json, type: SelfTestType, lba: number) {
  const log = (json.ata_smart_self_test_log ?? {}) as Json;
  json.ata_smart_self_test_log = log;
  const key = log.extended || !log.standard ? "extended" : "standard";
  const section = (log[key] ?? { revision: 1 }) as Json;
  log[key] = section;
  const table = Array.isArray(section.table) ? section.table : [];
  section.table = [
    {
      type: {
        value: type === "short" ? 1 : 2,
        string: ATA_SELF_TEST_NAMES[type],
      },
      status: ATA_READ_FAILURE_STATUS,
      lifetime_hours: powerOnHours(json),
      lba,
    },
    ...table,
  ];
  section.count = (Number(section.count) || 0) + 1;
  section.error_count_total = (Number(section.error_count_total) || 0) + 1;
  section.error_count_outdated ??= 0;

  const selfTest = (json.ata_smart_data as Json | undefined)?.self_test as
    | Json
    | undefined;
  if (selfTest) {
    selfTest.status = {
      ...ATA_READ_FAILURE_STATUS,
      string:
        "the previous self-test completed having the read element of the test failed",
    };
  }
}

function addFailedNvmeSelfTest(json: Json, type: SelfTestType, lba: number) {
  const log = (json.nvme_self_test_log ?? {}) as Json;
  json.nvme_self_test_log = log;
  const table = Array.isArray(log.table) ? log.table : [];
  log.table = [
    {
      self_test_code: {
        value: type === "short" ? 1 : 2,
        string: type === "short" ? "Short" : "Extended",
      },
      self_test_result: { value: 7, string: "Completed: failed segments" },
      power_on_hours: nvmeHealthLog(json)?.power_on_hours ?? powerOnHours(json),
      segment: 2,
      nsid: 1,
      lba,
    },
    ...table,
  ];
}

export function failSelfTest(
  stored: StoredPayload,
  type: SelfTestType,
  lba: number,
): StoredPayload {
  const edited = editSmartctl(stored, (json) => {
    if (protocolOf(json) === "NVMe") addFailedNvmeSelfTest(json, type, lba);
    else addFailedAtaSelfTest(json, type, lba);
  });
  return withExitBits(edited, EXIT_BITS.selfTestLogHasErrors);
}
