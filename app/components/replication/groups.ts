import type {
  ReplicationEndpoint,
  ReplicationRow,
  ReplicationStatus,
} from "#shared/replications";
import {
  REPLICATION_STATUS_VOCABULARY,
  worstReplicationStatus,
} from "~/utils/vocabulary/replication";

export interface ReplicationGroup<Row extends ReplicationRow> {
  key: string;
  sourceHost: string | null;
  targetHost: string;
  status: ReplicationStatus;
  rows: Row[];
}

export const hostLabel = (endpoint: ReplicationEndpoint) =>
  endpoint.host.displayName || endpoint.host.name;

const rank = (status: ReplicationStatus) =>
  REPLICATION_STATUS_VOCABULARY[status].rank;

const byStatusThenName = (a: ReplicationRow, b: ReplicationRow) =>
  rank(b.status) - rank(a.status) ||
  (a.source?.dataset.name ?? a.target.dataset.name).localeCompare(
    b.source?.dataset.name ?? b.target.dataset.name,
  );

/**
 * Visual groups by source host → target host, worst status first, rows within a
 * group worst status first then by dataset. Nothing is stored: a group is only a
 * heading.
 */
export function groupReplications<Row extends ReplicationRow>(
  rows: readonly Row[],
): ReplicationGroup<Row>[] {
  const groups = new Map<string, ReplicationGroup<Row>>();
  for (const row of rows) {
    const sourceHost = row.source && hostLabel(row.source);
    const targetHost = hostLabel(row.target);
    const key = `${sourceHost ?? ""}\u0000${targetHost}`;
    const group = groups.get(key);
    if (group) group.rows.push(row);
    else
      groups.set(key, {
        key,
        sourceHost,
        targetHost,
        status: "ok",
        rows: [row],
      });
  }
  return [...groups.values()]
    .map((group) => ({
      ...group,
      status: worstReplicationStatus(group.rows.map((row) => row.status)),
      rows: [...group.rows].sort(byStatusThenName),
    }))
    .sort(
      (a, b) =>
        rank(b.status) - rank(a.status) ||
        (a.sourceHost ?? "").localeCompare(b.sourceHost ?? "") ||
        a.targetHost.localeCompare(b.targetHost),
    );
}

/**
 * Splits a target name into the prefix the replication adds and the part that
 * mirrors the source: `vault/replica/tank/a` from `tank/a` → `vault/replica/` +
 * `tank/a`. No split when the target does not end with the source's path.
 */
export function targetParts(row: Pick<ReplicationRow, "source" | "target">): {
  prefix: string;
  mirrored: string;
} {
  const target = row.target.dataset.name;
  const source = row.source?.dataset.name;
  if (source && target !== source && target.endsWith(`/${source}`)) {
    const cut = target.length - source.length;
    return { prefix: target.slice(0, cut), mirrored: target.slice(cut) };
  }
  return { prefix: "", mirrored: target };
}

export function statusSummary(rows: readonly ReplicationRow[]): string {
  const counts = new Map<ReplicationStatus, number>();
  for (const row of rows) {
    if (row.status === "ok" || row.status === "archived") continue;
    counts.set(row.status, (counts.get(row.status) ?? 0) + 1);
  }
  return [...counts]
    .sort(([a], [b]) => rank(b) - rank(a))
    .map(
      ([status, count]) =>
        `${count} ${REPLICATION_STATUS_VOCABULARY[status].label.toLowerCase()}`,
    )
    .join(" · ");
}
