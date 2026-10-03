import type { FaultKind } from "#shared/faults";
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
] as const satisfies readonly FaultKind[];

export const REPLICATION_ARCHIVED_REASON = "archived";

export interface ReplicationFaultScan {
  detections: Detection[];
  superseded: Supersession[];
  withdrawn: Withdrawal[];
}

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
    if (assessed.status !== "late" && assessed.status !== "stalled") continue;
    const key = String(row.id);
    const data = {
      targetName: assessed.target?.dataset.name ?? null,
      sourceName: assessed.source?.dataset.name ?? null,
      hostName: assessed.target?.host.name ?? null,
      lastSyncAt: iso(row.lastSyncAt),
      intervalSec:
        assessed.intervalMs === null
          ? null
          : Math.round(assessed.intervalMs / 1000),
    };
    if (assessed.status === "stalled") {
      scan.detections.push({
        kind: "replication-stalled",
        key,
        subjectId: row.id,
        severity: "error",
        data,
      });
      scan.superseded.push({
        ...subject,
        kinds: ["replication-late"],
        by: { kind: "replication-stalled", key },
      });
      continue;
    }
    scan.detections.push({
      kind: "replication-late",
      key,
      subjectId: row.id,
      severity: "warning",
      data,
    });
  }
  return scan;
}
