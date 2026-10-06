export { type ByteSystem, byteUnitFor, formatBytes } from "#shared/bytes";

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
