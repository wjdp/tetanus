import { type FaultView, LIVE_FAULT_STATES } from "#shared/faults";
import { listFaults } from "~~/server/services/faults";
import { type ReplicationRecord, replicationRecord } from "./queries";

export interface ReplicationDetail extends ReplicationRecord {
  faults: FaultView[];
}

/** The replication with its snapshot ladder, diary and live faults; syncs page separately. */
export function getReplication(
  id: number,
  now = new Date(),
): ReplicationDetail {
  return {
    ...replicationRecord(id, now),
    faults: listFaults({
      state: [...LIVE_FAULT_STATES],
      subject: { type: "replication", id },
    }).faults,
  };
}
