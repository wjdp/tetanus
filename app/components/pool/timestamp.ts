export function formatTimestamp(
  value: string | Date | null | undefined,
): string {
  if (!value) return "—";
  const date = typeof value === "string" ? new Date(value) : value;
  return `${date.toISOString().replace("T", " ").slice(0, 16)} UTC`;
}
