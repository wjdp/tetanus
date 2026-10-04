export const COLLECTOR_VERSION = "0.5.0";
export const MIN_COLLECTOR_VERSION = "0.3.0";

export const COLLECTOR_STATUSES = [
  "current",
  "outdated",
  "incompatible",
  "unknown",
] as const;
export type CollectorStatus = (typeof COLLECTOR_STATUSES)[number];

const VERSION = /^(\d+)\.(\d+)\.(\d+)$/;
const COLLECTOR_PRODUCER = /^tetanus-collect\/(\d+\.\d+\.\d+)$/;

function versionParts(version: string) {
  return version.match(VERSION)?.slice(1).map(Number) ?? null;
}

function isOlder(version: number[], than: string) {
  const other = versionParts(than) as number[];
  const index = version.findIndex((part, i) => part !== other[i]);
  return index !== -1 && version[index] < other[index];
}

export function collectorStatus(version: string | null): CollectorStatus {
  const parts = version === null ? null : versionParts(version);
  if (!parts) return "unknown";
  if (isOlder(parts, MIN_COLLECTOR_VERSION)) return "incompatible";
  if (isOlder(parts, COLLECTOR_VERSION)) return "outdated";
  return "current";
}

export function parseCollectorProducer(producer: string | null) {
  return producer?.match(COLLECTOR_PRODUCER)?.[1] ?? null;
}

export function upgradeCommand(serverUrl: string) {
  return `curl -fsSL ${serverUrl}/host/install.sh | sudo bash`;
}
