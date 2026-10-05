import type {
  SeagateFarm,
  SeagateFarmHead,
  VoltageRange,
} from "#shared/smartctl";

type Json = Record<string, unknown>;

const object = (raw: unknown): Json =>
  typeof raw === "object" && raw !== null && !Array.isArray(raw)
    ? (raw as Json)
    : {};

const number = (raw: unknown) => (typeof raw === "number" ? raw : undefined);

const reported = (raw: unknown) => {
  const value = number(raw);
  return value === 0 ? undefined : value;
};

const trimmed = (raw: unknown) => {
  const value = typeof raw === "string" ? raw.trim() : "";
  return value === "" ? undefined : value;
};

function withoutUndefined<T extends object>(obj: T): T {
  return Object.fromEntries(
    Object.entries(obj).filter(([, value]) => value !== undefined),
  ) as T;
}

function logVersion(raw: unknown) {
  return Array.isArray(raw) && raw.every((part) => typeof part === "number")
    ? raw.join(".")
    : undefined;
}

export function farmWwn(raw: unknown) {
  const value = trimmed(raw)?.toLowerCase().replace(/^0x/, "");
  return value && /^[0-9a-f]{16}$/.test(value) ? value : undefined;
}

/** `YYWW` as printed by smartctl → ISO week, e.g. `2203` → `2022-W03`. */
export function assembledWeek(raw: unknown) {
  const match = trimmed(raw)?.match(/^(\d{2})(\d{2})$/);
  if (!match) return undefined;
  const week = Number(match[2]);
  if (week < 1 || week > 53) return undefined;
  return `20${match[1]}-W${match[2]}`;
}

function headCount(heads: unknown, ...pages: Json[]) {
  const declared = number(heads);
  if (declared !== undefined) return declared;
  const indices = pages.flatMap((page) =>
    Object.keys(page).map((key) => Number(key.match(/_(\d+)$/)?.[1] ?? -1)),
  );
  return Math.max(-1, ...indices) + 1;
}

function headValues(
  count: number,
  read: (head: number) => SeagateFarmHead,
): SeagateFarmHead[] {
  return Array.from({ length: count }, (_, head) =>
    withoutUndefined(read(head)),
  );
}

function sumOf(...values: (number | undefined)[]) {
  const present = values.filter((value) => value !== undefined);
  return present.length ? present.reduce((a, b) => a + b, 0) : undefined;
}

function voltages(current: unknown, minimum: unknown, maximum: unknown) {
  const range: VoltageRange = withoutUndefined({
    current: reported(current),
    minimum: reported(minimum),
    maximum: reported(maximum),
  });
  return Object.keys(range).length ? range : undefined;
}

function parseAta(log: Json): SeagateFarm {
  const header = object(log.page_0_log_header);
  const drive = object(log.page_1_drive_information);
  const workload = object(log.page_2_workload_statistics);
  const errors = object(log.page_3_error_statistics);
  const environment = object(log.page_4_environment_statistics);
  const reliability = object(log.page_5_reliability_statistics);
  const heads = headCount(drive.number_of_heads, reliability);
  const unrecoverable = (head: number) =>
    object(errors[`cum_lifetime_unrecoverable_by_head_${head}`]);
  const perHead = (name: string, head: number) =>
    number(reliability[`${name}_${head}`]);

  return withoutUndefined({
    interface: "ata" as const,
    logVersion: logVersion(header.farm_log_version),
    serial: trimmed(drive.serial_number),
    wwn: farmWwn(drive.world_wide_name),
    powerOnHours: number(drive.poh),
    spindleHours: number(drive.spoh),
    headFlightHours: number(drive.head_flight_hours),
    headLoadEvents: number(drive.head_load_events),
    powerCycles: number(drive.power_cycle_count),
    resetCount: number(drive.reset_count),
    heads,
    recordingType: trimmed(drive.drive_recording_type),
    assembledWeek: assembledWeek(drive.date_of_assembly),
    heliumPressureTripped:
      typeof reliability.helium_presure_trip === "number"
        ? reliability.helium_presure_trip !== 0
        : undefined,
    workload: withoutUndefined({
      readCommands: number(workload.total_read_commands),
      writeCommands: number(workload.total_write_commands),
      randomReads: number(workload.total_random_reads),
      randomWrites: number(workload.total_random_writes),
      sectorsRead: number(workload.logical_sectors_read),
      sectorsWritten: number(workload.logical_sectors_written),
    }),
    errors: withoutUndefined({
      unrecoverableReads: number(errors.number_of_unrecoverable_read_errors),
      unrecoverableWrites: number(errors.number_of_unrecoverable_write_errors),
      reallocatedSectors: number(errors.number_of_reallocated_sectors),
      reallocationCandidates: number(
        errors.number_of_reallocated_candidate_sectors,
      ),
      mechanicalStartFailures: number(
        errors.number_of_mechanical_start_failures,
      ),
      asrEvents: number(errors.total_asr_events),
      crcErrors: number(errors.total_crc_errors),
      commandTimeouts: number(errors.command_time_out_count_total),
    }),
    environment: withoutUndefined({
      highestCelsius: number(environment.highest_temp),
      lowestCelsius: number(environment.lowest_temp),
      averageCelsius: number(environment.average_temp),
      specifiedMaxCelsius: number(environment.max_temp),
      specifiedMinCelsius: number(environment.min_temp),
      millivolts12: voltages(
        environment.current_12v_in_mv,
        environment.minimum_12v_in_mv,
        environment.maximum_12v_in_mv,
      ),
      millivolts5: voltages(
        environment.current_5v_in_mv,
        environment.minimum_5v_in_mv,
        environment.maximum_5v_in_mv,
      ),
    }),
    perHead: headValues(heads, (head) => ({
      mrResistance: perHead("mr_head_resistance_from_head", head),
      secondMrResistance: perHead("second_mr_head_resistance_by_head", head),
      reallocatedSectors: perHead(
        "number_of_reallocated_sectors_by_head",
        head,
      ),
      reallocationCandidates: perHead(
        "number_of_reallocation_candidate_sectors_by_head",
        head,
      ),
      writeWorkloadPowerOn: perHead(
        "write_workload_power_on_time_by_head",
        head,
      ),
      unrecoverableReadsRepeating: number(
        unrecoverable(head).cum_lifetime_unrecoverable_read_repeating,
      ),
      unrecoverableReadsUnique: number(
        unrecoverable(head).cum_lifetime_unrecoverable_read_unique,
      ),
      skipWriteDetections: sumOf(
        perHead("dvga_skip_write_detect_by_head", head),
        perHead("rvga_skip_write_detect_by_head", head),
        perHead("fvga_skip_write_detect_by_head", head),
      ),
    })),
  });
}

// Mapped from smartmontools farmprint.cpp (scsiPrintFarmLog); no SAS Seagate fixture yet.
function parseScsi(log: Json): SeagateFarm {
  const header = object(log.log_header);
  const drive = object(log.drive_information);
  const driveContinued = object(log.drive_information_continued);
  const workload = object(log.workload_statistics);
  const errors = object(log.error_statistics);
  const environment = object(log.environment_statistics);
  const reliability = object(log.reliability_statistics);
  const byHead = object(log.head_information);
  const heads = headCount(drive.number_of_heads, byHead);
  const perHead = (name: string, head: number) =>
    number(byHead[`${name}_${head}`]);

  return withoutUndefined({
    interface: "scsi" as const,
    logVersion: logVersion(header.farm_log_version),
    serial: trimmed(drive.serial_number),
    wwn: farmWwn(drive.world_wide_name),
    powerOnHours: number(drive.power_on_hour),
    powerCycles: number(drive.power_cycle_count),
    resetCount: number(drive.hardware_reset_count),
    heads,
    recordingType: trimmed(driveContinued.drive_recording_type),
    assembledWeek: assembledWeek(drive.date_of_assembled),
    heliumPressureTripped:
      typeof reliability.helium_pressure_threshold_tripped === "number"
        ? reliability.helium_pressure_threshold_tripped !== 0
        : undefined,
    workload: withoutUndefined({
      readCommands: number(workload.total_number_of_read_commands),
      writeCommands: number(workload.total_number_of_write_commands),
      randomReads: number(workload.total_number_of_random_read_cmds),
      randomWrites: number(workload.total_number_of_random_write_cmds),
      sectorsRead: number(workload.logical_sectors_read),
      sectorsWritten: number(workload.logical_sectors_written),
    }),
    errors: withoutUndefined({
      unrecoverableReads: number(errors.unrecoverable_read_errors),
      unrecoverableWrites: number(errors.unrecoverable_write_errors),
      mechanicalStartFailures: number(
        errors.number_of_mechanical_start_failures,
      ),
    }),
    environment: withoutUndefined({
      highestCelsius: number(environment.highest_temperature),
      lowestCelsius: number(environment.lowest_temperature),
      specifiedMaxCelsius: number(
        environment.specified_max_operating_temperature,
      ),
      specifiedMinCelsius: number(
        environment.specified_min_operating_temperature,
      ),
    }),
    perHead: headValues(heads, (head) => ({
      mrResistance: perHead("mr_head_resistance", head),
      secondMrResistance: perHead("second_mr_head_resistance", head),
      reallocatedSectors: perHead("number_of_reallocated_sectors", head),
      reallocationCandidates: perHead(
        "number_of_reallocation_candidate_sectors",
        head,
      ),
      writeWorkloadPowerOn: perHead("write_power_on_(sec)", head),
      unrecoverableReadsRepeating: perHead(
        "cum_lifetime_unrecoverable_read_repeating",
        head,
      ),
      unrecoverableReadsUnique: perHead(
        "cum_lifetime_unrecoverable_read_unique",
        head,
      ),
    })),
  });
}

export function extractSeagateFarm(raw: unknown): SeagateFarm | undefined {
  const log = object(raw);
  if (log.supported === false) return undefined;
  if ("page_1_drive_information" in log) return parseAta(log);
  if ("drive_information" in log) return parseScsi(log);
  return undefined;
}
