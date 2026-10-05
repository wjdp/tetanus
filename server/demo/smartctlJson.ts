import { forkRng } from "./prng";
import {
  type AtaAttributeJson,
  type DeviceStatisticJson,
  type SmartctlJson,
  smartTemplate,
  templateBlockSizes,
} from "./smartTemplates";
import type { Stories } from "./stories";
import { addMs, DAY_MS, HOUR_MS } from "./timeline";
import type { DiskModel, HostModel, SmartCounters, Vendor } from "./types";

const MINUTE_MS = 60_000;
const MiB = 1024 * 1024;
const NVME_DATA_UNIT_BYTES = 512_000;
/** Intel DC SSDs count attributes 241/242 in 32 MiB units; everything else in 512-byte LBAs. */
const INTEL_LBA_UNIT_BYTES = 32 * MiB;
const ATA_SELF_TEST_LOG_ENTRIES = 21;
const NVME_SELF_TEST_LOG_ENTRIES = 20;
const ERROR_LOG_ENTRIES_SHOWN = 8;
/** smartd schedule: short every Wednesday at 02:00 UTC, long on the 15th at 03:00 UTC. */
const SHORT_TEST = { weekday: 3, hour: 2 } as const;
const LONG_TEST = { dayOfMonth: 15, hour: 3 } as const;
const NVME_SHORT_TEST_MINUTES = 2;

/** smartctl `-x` prints the GP (`extended`) self-test log, as in the mars fixtures. */
const SELF_TEST_LOG_KEY = "extended";

const EXIT_BITS = {
  diskFailing: 1 << 3,
  prefailBelowThreshold: 1 << 4,
  pastBelowThreshold: 1 << 5,
  errorLogHasErrors: 1 << 6,
  selfTestLogHasErrors: 1 << 7,
} as const;

const PCI_VENDOR_IDS: Partial<Record<Vendor, number>> = {
  wd: 0x15b7,
  crucial: 0xc0a9,
};

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

export interface RenderedXall {
  body: string;
  exitStatus: number;
}

interface TemperatureRange {
  current: number;
  powerCycleMin: number;
  powerCycleMax: number;
  lifetimeMin: number;
  lifetimeMax: number;
}

interface SelfTestRun {
  kind: "short" | "long";
  completedAt: Date;
  lifetimeHours: number;
  passed: boolean;
}

interface ErrorLogEntry {
  at: Date;
  lifetimeHours: number;
  lba: number;
}

interface RenderContext {
  stories: Stories;
  disk: DiskModel;
  t: Date;
  counters: SmartCounters;
  temperature: TemperatureRange;
  selfTests: SelfTestRun[];
  errors: ErrorLogEntry[];
}

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

function asctime(t: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  const day = String(t.getUTCDate()).padStart(2, " ");
  const clock = `${pad(t.getUTCHours())}:${pad(t.getUTCMinutes())}:${pad(t.getUTCSeconds())}`;
  return `${WEEKDAYS[t.getUTCDay()]} ${MONTHS[t.getUTCMonth()]} ${day} ${clock} ${t.getUTCFullYear()} UTC`;
}

const SMARTCTL_VERSION = /^smartctl (\d+)\.(\d+) \S+ r(\d+) \[([^\]]+)\] (.+)$/;

export interface SmartctlBuild {
  version: [number, number];
  svn_revision: string;
  platform_info: string;
  build_info: string;
}

/** The `smartctl` header fields smartctl derives from its own build, from the host's `smartctl --version` line. */
export function smartctlBuild(host: HostModel): SmartctlBuild {
  const [, major, minor, revision, platform, build] =
    SMARTCTL_VERSION.exec(host.smartctlVersion) ?? [];
  return {
    version: [Number(major ?? 7), Number(minor ?? 5)],
    svn_revision: revision ?? "",
    platform_info: platform ?? "",
    build_info: build ?? "",
  };
}

function rewriteSmartctlHeader(
  json: SmartctlJson,
  host: HostModel,
  disk: DiskModel,
) {
  const build = smartctlBuild(host);
  const deviceType = disk.scanType === "nvme" ? ["-d", "nvme"] : [];
  json.smartctl = {
    ...json.smartctl,
    ...build,
    argv: [
      "smartctl",
      "--xall",
      "--json",
      "-n",
      "standby",
      ...deviceType,
      disk.smartctlDevice,
    ],
    ...(json.smartctl.drive_database_version !== undefined && {
      drive_database_version: {
        string: `${build.version.join(".")}/${Number(build.svn_revision) - 8}`,
      },
    }),
  };
}

function temperatureRange(
  stories: Stories,
  disk: DiskModel,
  current: number,
): TemperatureRange {
  const rng = forkRng(`smart:${disk.alias}:temperature-range`);
  const typical = stories.host(disk.host).ambientC + disk.temperatureOffsetC;
  const powerCycleMin = Math.min(current, typical - rng.int(3, 6));
  const powerCycleMax = Math.max(current, typical + rng.int(4, 7));
  return {
    current,
    powerCycleMin,
    powerCycleMax,
    lifetimeMin: Math.min(powerCycleMin, typical - rng.int(8, 12)),
    lifetimeMax: Math.max(powerCycleMax, typical + rng.int(9, 14)),
  };
}

// Self-tests and the error log.

function testStarts(t: Date, count: number, kind: SelfTestRun["kind"]): Date[] {
  const starts: Date[] = [];
  if (kind === "short") {
    const cursor = new Date(t);
    cursor.setUTCHours(SHORT_TEST.hour, 0, 0, 0);
    cursor.setUTCDate(
      cursor.getUTCDate() - ((cursor.getUTCDay() - SHORT_TEST.weekday + 7) % 7),
    );
    for (let index = 0; index < count; index++) {
      starts.push(addMs(cursor, -index * 7 * DAY_MS));
    }
    return starts;
  }
  for (let index = 0; index < count; index++) {
    starts.push(
      new Date(
        Date.UTC(
          t.getUTCFullYear(),
          t.getUTCMonth() - index,
          LONG_TEST.dayOfMonth,
          LONG_TEST.hour,
        ),
      ),
    );
  }
  return starts;
}

function selfTestRuns(
  stories: Stories,
  disk: DiskModel,
  t: Date,
  durations: Record<SelfTestRun["kind"], number>,
  capacity: number,
): SelfTestRun[] {
  const kinds: SelfTestRun["kind"][] =
    disk.protocol === "nvme" ? ["short"] : ["short", "long"];
  const until = disk.removedAt && disk.removedAt < t ? disk.removedAt : t;
  return kinds
    .flatMap((kind) =>
      testStarts(t, capacity + 1, kind).map((start) => ({
        kind,
        start,
        completedAt: addMs(start, durations[kind] * MINUTE_MS),
      })),
    )
    .filter(
      ({ start, completedAt }) =>
        start >= disk.installedAt && completedAt <= until,
    )
    .sort((a, b) => b.completedAt.getTime() - a.completedAt.getTime())
    .slice(0, capacity)
    .map(({ kind, completedAt }) => ({
      kind,
      completedAt,
      lifetimeHours: stories.powerOnHours(disk, completedAt),
      passed: stories.healthPassed(disk, completedAt),
    }));
}

/** A7 logs a couple of UNC reads during its reallocation climb; V2 logs one most days once it degrades. */
function errorInstants(stories: Stories, disk: DiskModel): Date[] {
  const { timeline } = stories;
  if (disk.alias === "A7") {
    return [
      addMs(timeline.a7ClimbFrom, 11 * DAY_MS + 14 * HOUR_MS + 23 * MINUTE_MS),
      addMs(timeline.anchor, -3 * DAY_MS + 9 * HOUR_MS + 51 * MINUTE_MS),
    ];
  }
  if (disk.alias === "V2") {
    const instants: Date[] = [];
    const until = timeline.v2PulledAt.getTime();
    for (
      let at = timeline.v2DegradingFrom.getTime() + 5 * DAY_MS;
      at < until;
      at += 19 * HOUR_MS
    ) {
      instants.push(new Date(at));
    }
    return instants;
  }
  return [];
}

function errorLog(stories: Stories, disk: DiskModel, t: Date) {
  const rng = forkRng(`smart:${disk.alias}:error-lbas`);
  const sectors = Math.floor(disk.capacityBytes / 512);
  const firstBadLba = rng.int(0, sectors - 1_000_000);
  return errorInstants(stories, disk)
    .map(
      (at, index): ErrorLogEntry => ({
        at,
        lifetimeHours: stories.powerOnHours(disk, at),
        lba: firstBadLba + index * 8 + rng.int(0, 7),
      }),
    )
    .filter((entry) => entry.at <= t);
}

function ataErrorLogJson(template: SmartctlJson, errors: ErrorLogEntry[]) {
  const extended = (template.ata_smart_error_log?.extended ?? {}) as Record<
    string,
    unknown
  >;
  const { revision = 1, sectors = 1 } = extended;
  if (errors.length === 0) return { extended: { revision, sectors, count: 0 } };
  const shown = errors.slice(-ERROR_LOG_ENTRIES_SHOWN).reverse();
  return {
    extended: {
      revision,
      sectors,
      count: errors.length,
      logged_count: shown.length,
      table: shown.map((entry, index) => ({
        error_number: errors.length - index,
        log_index: (errors.length - 1 - index) % 20,
        lifetime_hours: entry.lifetimeHours,
        device_state: { value: 3, string: "active or idle" },
        completion_registers: {
          error: 64,
          status: 81,
          count: 0,
          lba: entry.lba,
          device: 0,
          device_control: 0,
        },
        error_description: `Error: UNC at LBA = 0x${entry.lba.toString(16)} = ${entry.lba}`,
        previous_commands: [0, 256, 512].map((offset, step) => ({
          registers: {
            command: 96,
            features: 0,
            count: 256,
            lba: entry.lba + offset,
            device: 64,
            device_control: 0,
          },
          powerup_milliseconds: (entry.at.getTime() % (7 * DAY_MS)) - step * 3,
          command_name: "READ FPDMA QUEUED",
        })),
      })),
    },
  };
}

function ataSelfTestLogJson(runs: SelfTestRun[], lba: number) {
  const failed = runs.filter((run) => !run.passed).length;
  return {
    [SELF_TEST_LOG_KEY]: {
      revision: 1,
      table: runs.map((run) => ({
        type:
          run.kind === "short"
            ? { value: 1, string: "Short offline" }
            : { value: 2, string: "Extended offline" },
        status: run.passed
          ? { value: 0, string: "Completed without error", passed: true }
          : {
              value: 121,
              string: "Completed: read failure",
              remaining_percent: 90,
              passed: false,
            },
        lifetime_hours: run.lifetimeHours,
        ...(!run.passed && { lba }),
      })),
      count: runs.length,
      error_count_total: failed,
      error_count_outdated: 0,
    },
  };
}

// ATA attributes.

function setRaw(row: AtaAttributeJson, raw: number, text = String(raw)) {
  row.raw = { value: raw, string: text };
}

/** Moves a wear-style normalised value (100 when new) in proportion to its raw count, as the template drive did. */
function scaledValue(template: AtaAttributeJson, raw: number): number {
  if (template.value > 100 || template.raw.value <= 0) return template.value;
  const deficit = ((100 - template.value) * raw) / template.raw.value;
  return clamp(Math.round(100 - deficit), 1, 100);
}

function setScaled(
  row: AtaAttributeJson,
  template: AtaAttributeJson,
  raw: number,
) {
  setRaw(row, raw);
  row.value = scaledValue(template, raw);
  row.worst = template.worst === template.value ? row.value : template.worst;
}

/**
 * Temperature raws pack current, min and max into the 48-bit raw like the template
 * drive does; the bytes holding a min or max are found from the template's own layout.
 */
function encodeTemperature(
  template: AtaAttributeJson,
  current: number,
  [min, max]: [number, number],
): { value: number; text: string } {
  const bytes = Array.from(
    { length: 6 },
    (_, index) => Math.floor(template.raw.value / 256 ** index) % 256,
  );
  const templateCurrent = bytes[0] ?? 0;
  const packed = bytes.map((byte, index) => {
    if (index === 0) return current;
    if (byte === 0) return 0;
    return byte < templateCurrent ? min : max;
  });
  const value = packed.reduce(
    (total, byte, index) => total + byte * 256 ** index,
    0,
  );
  if (/Min\/Max/.test(template.raw.string)) {
    return {
      value,
      text: `${current} (Min/Max ${min}/${max})`,
    };
  }
  if (/^\d+ \([\d ]+\)$/.test(template.raw.string)) {
    return {
      value,
      text: `${current} (${packed.slice(1).reverse().join(" ")})`,
    };
  }
  return { value: current, text: String(current) };
}

/** 190 (airflow) reports min/max since power-on, 194 over the drive's lifetime. */
function rewriteTemperatureAttribute(
  row: AtaAttributeJson,
  template: AtaAttributeJson,
  range: TemperatureRange,
) {
  const encoded = encodeTemperature(
    template,
    range.current,
    row.id === 190
      ? [range.powerCycleMin, range.powerCycleMax]
      : [range.lifetimeMin, range.lifetimeMax],
  );
  setRaw(row, encoded.value, encoded.text);
  const templateCurrent = template.raw.value % 256;
  if (template.value === 100 - templateCurrent) {
    row.value = 100 - range.current;
    row.worst = Math.min(template.worst, 100 - range.lifetimeMax);
  } else if (Math.abs(template.value - templateCurrent) <= 1) {
    row.value = range.current + template.value - templateCurrent;
  } else if (
    Math.abs(template.value - Math.floor(6500 / templateCurrent)) <= 1
  ) {
    row.value = Math.floor(6500 / range.current);
    row.worst =
      template.worst === template.value
        ? row.value
        : Math.floor(6500 / range.lifetimeMax);
  }
}

function rewriteDefectAttribute(
  row: AtaAttributeJson,
  count: number,
  failing: boolean,
) {
  setRaw(row, count);
  if (failing && row.flags.prefailure && row.thresh > 0) {
    row.value = row.thresh;
    row.worst = row.thresh;
    row.when_failed = "now";
    return;
  }
  row.value = Math.max(row.thresh + 1, 100 - Math.floor(count / 100));
  row.worst = Math.min(row.worst, row.value);
}

function lbaUnitBytes(disk: DiskModel) {
  return disk.template === "intelS4610" ? INTEL_LBA_UNIT_BYTES : 512;
}

function rewriteAtaAttributes(json: SmartctlJson, context: RenderContext) {
  const table = json.ata_smart_attributes?.table;
  if (!table) return;
  const { counters, disk, temperature } = context;
  const original = new Map(table.map((row) => [row.id, structuredClone(row)]));
  const templateRaw = (id: number) => original.get(id)?.raw.value ?? 0;
  const hours = counters.powerOnHours;
  const cycles = counters.powerCycles;
  const lbasWritten = Math.floor(counters.bytesWritten / lbaUnitBytes(disk));
  const lbasRead = Math.floor(counters.bytesRead / lbaUnitBytes(disk));
  const percentageUsed = counters.percentageUsed ?? 0;
  const loadCycles = Math.round(
    (templateRaw(193) / Math.max(1, templateRaw(9))) * hours,
  );

  for (const row of table) {
    const template = original.get(row.id);
    if (!template) continue;
    switch (row.id) {
      case 4:
        setScaled(
          row,
          template,
          Math.max(
            cycles,
            Math.round((cycles * template.raw.value) / (templateRaw(12) || 1)),
          ),
        );
        break;
      case 5:
        rewriteDefectAttribute(
          row,
          counters.reallocatedSectors,
          !counters.healthPassed,
        );
        break;
      case 9:
        setScaled(row, template, hours);
        break;
      case 12:
        setScaled(row, template, cycles);
        break;
      case 174:
        setRaw(row, counters.unsafeShutdowns);
        break;
      case 177:
        setRaw(
          row,
          Math.round((counters.bytesWritten / disk.capacityBytes) * 1.3),
        );
        row.value = clamp(100 - percentageUsed, 1, 100);
        row.worst = row.value;
        break;
      case 190:
      case 194:
        rewriteTemperatureAttribute(row, template, temperature);
        break;
      case 192:
        setScaled(
          row,
          template,
          template.raw.value === templateRaw(193)
            ? loadCycles
            : Math.round(
                (cycles * template.raw.value) / (templateRaw(12) || 1),
              ),
        );
        break;
      case 193:
        setScaled(row, template, loadCycles);
        break;
      case 197:
        rewriteDefectAttribute(row, counters.pendingSectors, false);
        break;
      case 198:
        rewriteDefectAttribute(row, counters.offlineUncorrectable, false);
        break;
      case 233:
      case 241:
        setRaw(row, lbasWritten);
        break;
      case 235:
        if (template.name === "POR_Recovery_Count") {
          setRaw(row, counters.unsafeShutdowns);
        } else {
          setRaw(row, lbasWritten);
        }
        break;
      case 240: {
        const headHours = Math.max(
          0,
          hours - (templateRaw(9) - leadingHours(template)),
        );
        setRaw(
          row,
          template.raw.value - leadingHours(template) + headHours,
          template.raw.string.replace(/^\d+/, String(headHours)),
        );
        break;
      }
      case 242:
        setRaw(row, lbasRead);
        break;
      case 245:
        setRaw(row, clamp(100 - percentageUsed, 0, 100));
        row.value = clamp(100 - percentageUsed, 1, 100);
        row.worst = row.value;
        break;
    }
  }
}

function leadingHours(row: AtaAttributeJson): number {
  return Number(/^(\d+)/.exec(row.raw.string)?.[1] ?? 0);
}

function rewriteDeviceStatistics(json: SmartctlJson, context: RenderContext) {
  const { counters, temperature, disk } = context;
  const logical = templateBlockSizes(disk.template).logical;
  const byName: Record<string, number> = {
    "Lifetime Power-On Resets": counters.powerCycles,
    "Power-on Hours": counters.powerOnHours,
    "Logical Sectors Written": Math.floor(counters.bytesWritten / logical),
    "Logical Sectors Read": Math.floor(counters.bytesRead / logical),
    "Spindle Motor Power-on Hours": counters.powerOnHours,
    "Number of Reallocated Logical Sectors": counters.reallocatedSectors,
    "Number of Realloc. Candidate Logical Sectors": counters.pendingSectors,
    "Current Temperature": temperature.current,
    "Highest Temperature": temperature.lifetimeMax,
    "Lowest Temperature": temperature.lifetimeMin,
    "Percentage Used Endurance Indicator": counters.percentageUsed ?? 0,
  };
  for (const page of json.ata_device_statistics?.pages ?? []) {
    for (const row of page.table ?? []) setStatistic(row, byName);
  }
}

function setStatistic(
  row: DeviceStatisticJson,
  byName: Record<string, number>,
) {
  const value = byName[row.name];
  if (value !== undefined && row.value !== undefined) row.value = value;
}

function rewriteSct(json: SmartctlJson, context: RenderContext) {
  const { temperature, counters, stories, disk, t } = context;
  const status = json.ata_sct_status;
  if (status) {
    status.temperature = {
      ...status.temperature,
      current: temperature.current,
      power_cycle_min: temperature.powerCycleMin,
      power_cycle_max: temperature.powerCycleMax,
      lifetime_min: temperature.lifetimeMin,
      lifetime_max: temperature.lifetimeMax,
    };
    status.smart_status = { passed: counters.healthPassed };
  }
  const history = json.ata_sct_temperature_history;
  if (!history) return;
  const intervalMs = history.logging_interval_minutes * MINUTE_MS;
  const newest = history.table.length - 1;
  const byHour = new Map<number, number>();
  const at = (sampledAt: Date) => {
    const hour = Math.floor(sampledAt.getTime() / HOUR_MS);
    const cached = byHour.get(hour);
    if (cached !== undefined) return cached;
    const celsius = stories.temperature(disk, sampledAt);
    byHour.set(hour, celsius);
    return celsius;
  };
  history.table = history.table.map((_, index) => {
    const sampledAt = addMs(t, -(newest - index) * intervalMs);
    return sampledAt < disk.installedAt ? null : at(sampledAt);
  });
}

function rewriteAtaTemperature(json: SmartctlJson, range: TemperatureRange) {
  const current = json.temperature;
  json.temperature = {
    ...current,
    current: range.current,
    ...("power_cycle_min" in current && {
      power_cycle_min: range.powerCycleMin,
      power_cycle_max: range.powerCycleMax,
    }),
    ...("lifetime_min" in current && {
      lifetime_min: range.lifetimeMin,
      lifetime_max: range.lifetimeMax,
    }),
  };
}

// NVMe.

function rewriteNvme(json: SmartctlJson, context: RenderContext) {
  const { counters, disk } = context;
  const log = json.nvme_smart_health_information_log;
  if (log) {
    const template = { ...log };
    const unitsRead = Math.floor(counters.bytesRead / NVME_DATA_UNIT_BYTES);
    const unitsWritten = Math.floor(
      counters.bytesWritten / NVME_DATA_UNIT_BYTES,
    );
    const ratio = (field: string, base: string) =>
      (template[field] ?? 0) / Math.max(1, template[base] ?? 1);
    const percentageUsed = clamp(counters.percentageUsed ?? 0, 0, 255);
    Object.assign(log, {
      critical_warning: 0,
      temperature: counters.temperatureC,
      available_spare: 100,
      percentage_used: percentageUsed,
      data_units_read: unitsRead,
      data_units_written: unitsWritten,
      host_reads: Math.round(
        unitsRead * ratio("host_reads", "data_units_read"),
      ),
      host_writes: Math.round(
        unitsWritten * ratio("host_writes", "data_units_written"),
      ),
      controller_busy_time: Math.round(
        counters.powerOnHours * ratio("controller_busy_time", "power_on_hours"),
      ),
      power_cycles: counters.powerCycles,
      power_on_hours: counters.powerOnHours,
      unsafe_shutdowns: counters.unsafeShutdowns,
      media_errors: counters.mediaErrors,
    });
  }
  json.temperature = { ...json.temperature, current: counters.temperatureC };
  json.smart_status = {
    passed: counters.healthPassed,
    nvme: { value: log?.critical_warning ?? 0 },
  };
  json.nvme_version = { string: "1.4", value: 0x10400 };
  const pciVendor = PCI_VENDOR_IDS[disk.vendor];
  if (pciVendor !== undefined) {
    json.nvme_pci_vendor = { id: pciVendor, subsystem_id: pciVendor };
  }
  const euiHex = disk.wwn.replace(/^eui\./, "");
  const oui = Number.parseInt(euiHex.slice(0, 6), 16);
  json.nvme_ieee_oui_identifier = oui;
  json.nvme_total_capacity = disk.capacityBytes;
  for (const namespace of json.nvme_namespaces ?? []) {
    const blocks = Math.floor(
      disk.capacityBytes / namespace.formatted_lba_size,
    );
    const extent = { blocks, bytes: disk.capacityBytes };
    namespace.size = extent;
    namespace.capacity = { ...extent };
    namespace.utilization = { ...extent };
    namespace.eui64 = {
      oui,
      ext_id: Number.parseInt(euiHex.slice(6), 16),
    };
  }
  json.nvme_self_test_log = {
    ...json.nvme_self_test_log,
    table: context.selfTests.map((run) => ({
      self_test_code: { value: 1, string: "Short" },
      self_test_result: run.passed
        ? { value: 0, string: "Completed without error" }
        : { value: 7, string: "Completed: failed segment" },
      power_on_hours: run.lifetimeHours,
    })),
  };
}

// Identity.

function wwnJson(wwn: string) {
  return {
    naa: Number.parseInt(wwn.slice(0, 1), 16),
    oui: Number.parseInt(wwn.slice(1, 7), 16),
    id: Number.parseInt(wwn.slice(7), 16),
  };
}

function rewriteIdentity(json: SmartctlJson, disk: DiskModel) {
  const { logical } = templateBlockSizes(disk.template);
  json.device =
    disk.protocol === "nvme"
      ? {
          name: disk.smartctlDevice,
          info_name: disk.smartctlDevice,
          type: "nvme",
          protocol: "NVMe",
        }
      : {
          ...json.device,
          name: disk.smartctlDevice,
          info_name:
            disk.protocol === "ata"
              ? `${disk.smartctlDevice} [SAT]`
              : disk.smartctlDevice,
        };
  if (disk.modelFamily) json.model_family = disk.modelFamily;
  else delete json.model_family;
  json.model_name = disk.model;
  json.serial_number = disk.serial;
  if (json.wwn) json.wwn = wwnJson(disk.wwn);
  if (json.firmware_version !== undefined)
    json.firmware_version = disk.firmware;
  if (json.revision !== undefined) json.revision = disk.firmware.slice(-4);
  json.user_capacity = {
    blocks: Math.floor(disk.capacityBytes / logical),
    bytes: disk.capacityBytes,
  };
  if (json.rotation_rate !== undefined) json.rotation_rate = disk.rpm ?? 0;
  if (json.form_factor) {
    json.form_factor = { ...json.form_factor, name: disk.formFactor };
  }
}

/** Keeps FARM in step with the rewritten SMART identity and counters, as on an untouched drive. */
function rewriteFarm(
  json: SmartctlJson,
  disk: DiskModel,
  counters: SmartCounters,
) {
  const drive = json.seagate_farm_log?.page_1_drive_information;
  if (!drive) return;
  drive.serial_number = disk.serial;
  drive.world_wide_name = `0x${disk.wwn}`;
  drive.poh = counters.powerOnHours;
  drive.spoh = counters.powerOnHours;
  drive.head_flight_hours = counters.powerOnHours;
  drive.power_cycle_count = counters.powerCycles;
}

function exitStatusOf(json: SmartctlJson, context: RenderContext): number {
  const table = json.ata_smart_attributes?.table ?? [];
  const bits = [
    !context.counters.healthPassed && EXIT_BITS.diskFailing,
    table.some(
      (row) =>
        row.flags.prefailure && row.thresh > 0 && row.value <= row.thresh,
    ) && EXIT_BITS.prefailBelowThreshold,
    table.some((row) => row.thresh > 0 && row.worst <= row.thresh) &&
      EXIT_BITS.pastBelowThreshold,
    context.errors.length > 0 && EXIT_BITS.errorLogHasErrors,
    context.selfTests.some((run) => !run.passed) &&
      EXIT_BITS.selfTestLogHasErrors,
  ];
  return bits.reduce<number>((total, bit) => total | (bit || 0), 0);
}

/** `smartctl --xall --json` for a present disk at `t`, from its model's template. */
export function renderXall(
  stories: Stories,
  host: HostModel,
  disk: DiskModel,
  t: Date,
): RenderedXall {
  const json = smartTemplate(disk.template);
  const counters = stories.smartCounters(disk, t);
  const polling = json.ata_smart_data?.self_test.polling_minutes;
  const selfTests = selfTestRuns(
    stories,
    disk,
    t,
    {
      short: polling?.short ?? NVME_SHORT_TEST_MINUTES,
      long: polling?.extended ?? NVME_SHORT_TEST_MINUTES,
    },
    disk.protocol === "nvme"
      ? NVME_SELF_TEST_LOG_ENTRIES
      : ATA_SELF_TEST_LOG_ENTRIES,
  );
  const context: RenderContext = {
    stories,
    disk,
    t,
    counters,
    temperature: temperatureRange(stories, disk, counters.temperatureC),
    selfTests,
    errors: errorLog(stories, disk, t),
  };

  rewriteSmartctlHeader(json, host, disk);
  json.local_time = {
    time_t: Math.floor(t.getTime() / 1000),
    asctime: asctime(t),
  };
  rewriteIdentity(json, disk);
  json.smart_status = { passed: counters.healthPassed };
  json.power_on_time = { hours: counters.powerOnHours };
  if (json.power_cycle_count !== undefined) {
    json.power_cycle_count = counters.powerCycles;
  }
  rewriteFarm(json, disk, counters);

  if (disk.protocol === "nvme") {
    rewriteNvme(json, context);
  } else if (disk.protocol === "scsi") {
    json.temperature = { ...json.temperature, current: counters.temperatureC };
    json.scsi_grown_defect_list = counters.reallocatedSectors;
  } else {
    rewriteAtaTemperature(json, context.temperature);
    rewriteAtaAttributes(json, context);
    rewriteDeviceStatistics(json, context);
    rewriteSct(json, context);
    const lba = context.errors.at(-1)?.lba ?? 0;
    json.ata_smart_self_test_log = ataSelfTestLogJson(selfTests, lba);
    json.ata_smart_error_log = ataErrorLogJson(json, context.errors);
    if (json.ata_pending_defects_log) {
      json.ata_pending_defects_log.count = counters.pendingSectors;
    }
    const lastTest = selfTests[0];
    if (json.ata_smart_data && lastTest && !lastTest.passed) {
      json.ata_smart_data.self_test.status = {
        value: 121,
        string:
          "the previous self-test completed having the read element of the test failed",
        remaining_percent: 90,
        passed: false,
      };
    }
  }

  const exitStatus = exitStatusOf(json, context);
  json.smartctl.exit_status = exitStatus;
  return { body: JSON.stringify(json, null, 2), exitStatus };
}
