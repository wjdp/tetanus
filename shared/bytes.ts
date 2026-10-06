export type ByteSystem = "decimal" | "binary";

const BYTE_SYSTEMS: Record<ByteSystem, { base: number; units: string[] }> = {
  decimal: { base: 1000, units: ["B", "kB", "MB", "GB", "TB", "PB"] },
  binary: { base: 1024, units: ["B", "KiB", "MiB", "GiB", "TiB", "PiB"] },
};

export function formatBytes(
  bytes: number | null | undefined,
  system: ByteSystem = "decimal",
): string {
  if (bytes === null || bytes === undefined) return "—";
  const { base, units } = BYTE_SYSTEMS[system];
  let value = bytes;
  let unit = 0;
  while (Math.abs(value) >= base && unit < units.length - 1) {
    value /= base;
    unit += 1;
  }
  const magnitude = Math.abs(value);
  const digits = unit === 0 || magnitude >= 100 ? 0 : magnitude >= 10 ? 1 : 2;
  return `${value.toFixed(digits)} ${units[unit]}`;
}

export function byteUnitFor(
  bytes: number,
  system: ByteSystem = "decimal",
): { unit: string; divisor: number } {
  const { base, units } = BYTE_SYSTEMS[system];
  let unit = 0;
  while (bytes >= base ** (unit + 1) && unit < units.length - 1) unit += 1;
  return { unit: units[unit], divisor: base ** unit };
}
