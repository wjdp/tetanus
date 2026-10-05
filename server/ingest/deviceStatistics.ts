import {
  DEVICE_STATISTIC_FIELDS,
  type DeviceStatistics,
  isDeviceStatisticKey,
} from "#shared/smart/deviceStatistics";

type Json = Record<string, unknown>;

const object = (raw: unknown): Json =>
  typeof raw === "object" && raw !== null && !Array.isArray(raw)
    ? (raw as Json)
    : {};

export function extractDeviceStatistics(
  raw: unknown,
): DeviceStatistics | undefined {
  const pages = object(raw).pages;
  if (!Array.isArray(pages)) return undefined;
  const statistics: DeviceStatistics = { normalised: [] };
  let found = false;
  for (const page of pages.map(object)) {
    const table = Array.isArray(page.table) ? page.table.map(object) : [];
    for (const entry of table) {
      const key = `${page.number}:${entry.offset}`;
      const flags = object(entry.flags);
      if (!isDeviceStatisticKey(key) || flags.valid !== true) continue;
      if (typeof entry.value !== "number") continue;
      const field = DEVICE_STATISTIC_FIELDS[key];
      statistics[field] = entry.value;
      if (flags.normalized === true) statistics.normalised.push(field);
      found = true;
    }
  }
  return found ? statistics : undefined;
}
