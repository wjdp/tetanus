import { formatDuration } from "#shared/hostFreshness";
import type { ReplicationRow, ReplicationStatus } from "#shared/replications";
import { REPLICATION_STATUS_VOCABULARY } from "~/utils/vocabulary/replication";

const MEASURED: readonly ReplicationStatus[] = ["ok", "late", "stalled"];

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
  if (!row.dueAt || !MEASURED.includes(row.status)) return "—";
  const dueIn = Date.parse(row.dueAt) - now;
  if (dueIn >= 0) return `in ${formatDuration(dueIn)}`;
  return row.status === "ok"
    ? `due ${formatDuration(-dueIn)} ago`
    : `overdue ${formatDuration(-dueIn)}`;
}

/** One phrase per row: when it is due while measured, otherwise what is wrong. */
export function statusText(
  row: Pick<ReplicationRow, "dueAt" | "status">,
  now: number,
): string {
  const { label } = REPLICATION_STATUS_VOCABULARY[row.status];
  if (!row.dueAt || !MEASURED.includes(row.status)) return label;
  const dueIn = Date.parse(row.dueAt) - now;
  if (row.status === "ok") {
    return dueIn >= 0
      ? `Due in ${formatDuration(dueIn)}`
      : `Due ${formatDuration(-dueIn)} ago`;
  }
  return `${label} · ${formatDuration(Math.max(0, -dueIn))} overdue`;
}
