import type {
  ReplicationEndpoint,
  ReplicationRow,
  ReplicationStatus,
} from "#shared/replications";
import { worstReplicationStatus } from "~/utils/vocabulary/replication";

export interface GroupSide {
  host: string;
  parent: string;
}

export interface ReplicationGroup<Row extends ReplicationRow> {
  key: string;
  source: GroupSide | null;
  target: GroupSide;
  status: ReplicationStatus;
  rows: Row[];
}

export const hostLabel = (endpoint: ReplicationEndpoint) =>
  endpoint.host.displayName || endpoint.host.name;

/** `tank/a/b` → `tank/a/*`; a pool root stands for itself. */
export function parentPattern(datasetName: string): string {
  const slash = datasetName.lastIndexOf("/");
  return slash === -1 ? datasetName : `${datasetName.slice(0, slash)}/*`;
}

const side = (endpoint: ReplicationEndpoint): GroupSide => ({
  host: hostLabel(endpoint),
  parent: parentPattern(endpoint.dataset.name),
});

const sideKey = (group: GroupSide | null) =>
  group ? `${group.host}\u0000${group.parent}` : "";

/**
 * Visual groups by source host + parent → target host + parent, in the order
 * their first row appears. Nothing is stored: a group is only a heading.
 */
export function groupReplications<Row extends ReplicationRow>(
  rows: readonly Row[],
): ReplicationGroup<Row>[] {
  const groups = new Map<string, ReplicationGroup<Row>>();
  for (const row of rows) {
    const source = row.source && side(row.source);
    const target = side(row.target);
    const key = `${sideKey(source)}\u0001${sideKey(target)}`;
    const group = groups.get(key);
    if (group) group.rows.push(row);
    else groups.set(key, { key, source, target, status: "ok", rows: [row] });
  }
  return [...groups.values()].map((group) => ({
    ...group,
    status: worstReplicationStatus(group.rows.map((row) => row.status)),
  }));
}
