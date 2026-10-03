import { type FaultView, LIVE_FAULT_STATES } from "#shared/faults";
import { listFaults } from "~~/server/services/faults";
import { type ReplicationRecord, replicationRecord } from "./queries";

export interface ReplicationDetail extends ReplicationRecord {
  faults: FaultView[];
}

/** The replication with its syncs, snapshot ladder, diary and live faults. */
export function getReplication(
  id: number,
  query: { page?: number } = {},
  now = new Date(),
): ReplicationDetail {
  return {
    ...replicationRecord(id, query, now),
    faults: listFaults({
      state: [...LIVE_FAULT_STATES],
      subject: { type: "replication", id },
    }).faults,
  };
}
