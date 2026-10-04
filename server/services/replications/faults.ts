import type { FaultKind } from "#shared/faults";
import type { ReplicationStatus } from "#shared/replications";
import { db } from "~~/server/database/client";
import { replication } from "~~/server/database/schema";
import type {
  Detection,
  Supersession,
  Withdrawal,
} from "~~/server/services/faults";
import { assessReplication, replicationContext } from "./queries";

export const REPLICATION_FAULT_KINDS = [
  "replication-late",
  "replication-stalled",
  "replication-target-gone",
] as const satisfies readonly FaultKind[];

export const REPLICATION_ARCHIVED_REASON = "archived";

export interface ReplicationFaultScan {
  detections: Detection[];
  superseded: Supersession[];
  withdrawn: Withdrawal[];
}

type ReplicationFaultKind = (typeof REPLICATION_FAULT_KINDS)[number];

const FAULT_KIND_OF_STATUS: Partial<
  Record<ReplicationStatus, ReplicationFaultKind>
> = {
  late: "replication-late",
  stalled: "replication-stalled",
  "target-gone": "replication-target-gone",
};

const SUPERSEDED_BY: Record<ReplicationFaultKind, FaultKind[]> = {
  "replication-late": [],
  "replication-stalled": ["replication-late"],
  "replication-target-gone": ["replication-late", "replication-stalled"],
};

const iso = (date: Date | null) => date?.toISOString() ?? null;

export function detectReplicationFaults(now: Date): ReplicationFaultScan {
  const rows = db.select().from(replication).all();
  const context = replicationContext(rows, now);
  const scan: ReplicationFaultScan = {
    detections: [],
    superseded: [],
    withdrawn: [],
  };
  for (const row of rows) {
    const assessed = assessReplication(row, context);
    const subject = { subjectType: "replication" as const, subjectId: row.id };
    if (assessed.status === "archived") {
      scan.withdrawn.push({ ...subject, reason: REPLICATION_ARCHIVED_REASON });
      continue;
    }
    const kind = FAULT_KIND_OF_STATUS[assessed.status];
    if (!kind) continue;
    const key = String(row.id);
    scan.detections.push({
      kind,
      key,
      subjectId: row.id,
      severity: kind === "replication-late" ? "warning" : "error",
      data: {
        targetName: assessed.target?.dataset.name ?? null,
        sourceName: assessed.source?.dataset.name ?? null,
        hostName: assessed.target?.host.name ?? null,
        lastSyncAt: iso(row.lastSyncAt),
        intervalSec:
          assessed.intervalMs === null
            ? null
            : Math.round(assessed.intervalMs / 1000),
      },
    });
    const supersedes = SUPERSEDED_BY[kind];
    if (supersedes.length > 0) {
      scan.superseded.push({
        ...subject,
        kinds: supersedes,
        by: { kind, key },
      });
    }
  }
  return scan;
}
