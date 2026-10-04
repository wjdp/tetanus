import { formatDuration } from "#shared/hostFreshness";
import type { ReplicationRow } from "#shared/replications";

export function lastSyncText(
  row: Pick<ReplicationRow, "lastSyncAt">,
  now: number,
): string {
  return row.lastSyncAt
    ? `${formatDuration(now - Date.parse(row.lastSyncAt))} ago`
    : "never";
}

export function dueText(
  row: Pick<ReplicationRow, "dueAt" | "status">,
  now: number,
): string {
  if (!row.dueAt || row.status === "archived") return "—";
  const dueIn = Date.parse(row.dueAt) - now;
  if (dueIn >= 0) return `in ${formatDuration(dueIn)}`;
  return row.status === "ok"
    ? `due ${formatDuration(-dueIn)} ago`
    : `overdue ${formatDuration(-dueIn)}`;
}
