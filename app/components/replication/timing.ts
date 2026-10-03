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
  return dueIn >= 0
    ? `in ${formatDuration(dueIn)}`
    : `overdue ${formatDuration(-dueIn)}`;
}
