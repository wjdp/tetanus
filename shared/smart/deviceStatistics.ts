/**
 * ATA Device Statistics (GP log 0x04, ACS), identified by `page:offset`. Entries that
 * roll or reset by design (1:56 time since power-on, 5:8 current and 5:16 short-term
 * temperature) and 4:24 (a notification flag) are deliberately absent (docs/084).
 */
export const DEVICE_STATISTIC_FIELDS = {
  "1:8": "powerOnResets",
  "1:16": "powerOnHours",
  "1:24": "sectorsWritten",
  "1:32": "writeCommands",
  "1:40": "sectorsRead",
  "1:48": "readCommands",
  "1:64": "pendingErrors",
  "2:16": "shockEvents",
  "3:8": "spindleHours",
  "3:16": "headFlightHours",
  "3:24": "headLoadEvents",
  "3:32": "reallocatedSectors",
  "3:40": "readRecoveryAttempts",
  "3:48": "mechanicalStartFailures",
  "3:56": "reallocationCandidates",
  "3:64": "highPriorityUnloads",
  "4:8": "reportedUncorrectables",
  "4:16": "commandResets",
  "5:24": "averageLongTermCelsius",
  "5:32": "highestCelsius",
  "5:40": "lowestCelsius",
  "5:64": "highestAverageLongTermCelsius",
  "5:72": "lowestAverageLongTermCelsius",
  "5:80": "minutesOverTemperature",
  "5:88": "specifiedMaxCelsius",
  "5:96": "minutesUnderTemperature",
  "5:104": "specifiedMinCelsius",
  "6:8": "hardwareResets",
  "6:16": "asrEvents",
  "6:24": "crcErrors",
  "7:8": "percentageUsed",
} as const;

export type DeviceStatisticField =
  (typeof DEVICE_STATISTIC_FIELDS)[keyof typeof DEVICE_STATISTIC_FIELDS];

export type DeviceStatistics = Partial<Record<DeviceStatisticField, number>> & {
  /** Fields the drive flags as normalised: show them, don't threshold them. */
  normalised: DeviceStatisticField[];
};

export function isDeviceStatisticKey(
  key: string,
): key is keyof typeof DEVICE_STATISTIC_FIELDS {
  return key in DEVICE_STATISTIC_FIELDS;
}
