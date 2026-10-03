import { db } from "~~/server/database/client";
import { host, replication } from "~~/server/database/schema";
import { setReplicationsBackfilledAt } from "~~/server/services/settings";
import { deriveSyncs } from "./derive";
import { pruneSyncs, receiveLines, recordSyncs } from "./population";
import { resolveReplicationSources } from "./sources";

export interface ReplicationsBackfillSummary {
  replications: number;
  sources: number;
}

/** Derives syncs from every host's stored receive history, once. */
export function backfillReplications(
  now = new Date(),
): ReplicationsBackfillSummary {
  return db.transaction(() => {
    for (const { id } of db.select({ id: host.id }).from(host).all()) {
      recordSyncs(id, deriveSyncs(receiveLines(id), now), now);
    }
    pruneSyncs(now);
    const sources = resolveReplicationSources();
    setReplicationsBackfilledAt(now);
    return {
      replications: db.select({ id: replication.id }).from(replication).all()
        .length,
      sources,
    };
  });
}
