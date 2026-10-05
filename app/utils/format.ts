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

export function formatHours(hours: number | null | undefined): string {
  if (hours === null || hours === undefined) return "—";
  const years = hours / (24 * 365.25);
  if (years >= 1) return `${years.toFixed(1)} y`;
  const days = Math.round(hours / 24);
  return days >= 1 ? `${days} d` : `${hours} h`;
}

export function formatDays(days: number | null | undefined): string {
  if (days === null || days === undefined) return "—";
  const years = days / 365.25;
  return Math.abs(years) >= 1 ? `${years.toFixed(1)} y` : `${days} d`;
}

export function formatDate(value: string | Date | null | undefined): string {
  if (!value) return "—";
  const date = typeof value === "string" ? new Date(value) : value;
  return date.toISOString().slice(0, 10);
}

export function formatCelsius(celsius: number | null | undefined): string {
  return celsius === null || celsius === undefined ? "—" : `${celsius} °C`;
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
