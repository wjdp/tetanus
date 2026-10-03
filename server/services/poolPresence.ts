import { and, eq, max } from "drizzle-orm";
import {
  type CadenceOverrides,
  isHostOffline,
  isHostSilent,
} from "#shared/hostFreshness";
import { MISSING_POOL_STATE } from "#shared/zfsState";
import { db } from "~~/server/database/client";
import { collectorRun, type pool } from "~~/server/database/schema";
import { type HostWithRuns, listHosts } from "~~/server/services/hosts";
import { collectorCadences } from "~~/server/utils/demo";

export type PoolPresence =
  | "present"
  | "missing"
  | "host-silent"
  | "host-offline"
  | "unscanned";

export interface PoolPresenceContext {
  now: Date;
  hosts: Map<number, HostWithRuns>;
  cadences: CadenceOverrides;
  latestStatus: Map<number, Date>;
}

function latestStatusTimes(): Map<number, Date> {
  return new Map(
    db
      .select({ hostId: collectorRun.hostId, at: max(collectorRun.receivedAt) })
      .from(collectorRun)
      .where(
        and(eq(collectorRun.source, "zpool-status"), eq(collectorRun.ok, true)),
      )
      .groupBy(collectorRun.hostId)
      .all()
      .flatMap(({ hostId, at }) => (at ? [[hostId, at] as const] : [])),
  );
}

export function poolPresenceContext(
  now: Date,
  hosts: HostWithRuns[] = listHosts(),
  cadences: CadenceOverrides = collectorCadences(),
): PoolPresenceContext {
  return {
    now,
    hosts: new Map(hosts.map((row) => [row.id, row])),
    cadences,
    latestStatus: latestStatusTimes(),
  };
}

export function poolPresence(
  row: Pick<typeof pool.$inferSelect, "hostId" | "lastSeenAt">,
  { now, hosts, cadences, latestStatus }: PoolPresenceContext,
): PoolPresence {
  const host = hosts.get(row.hostId);
  const at = now.getTime();
  if (host && isHostSilent(host, at, cadences)) return "host-silent";
  const statusAt = latestStatus.get(row.hostId);
  if (!statusAt) return "unscanned";
  if (row.lastSeenAt >= statusAt) return "present";
  if (host && isHostOffline(host, at, cadences)) return "host-offline";
  return "missing";
}

export function poolDisplayState(
  row: Pick<
    typeof pool.$inferSelect,
    "hostId" | "lastSeenAt" | "state" | "archivedAt"
  >,
  context: PoolPresenceContext,
): string {
  if (row.archivedAt === null && poolPresence(row, context) === "missing") {
    return MISSING_POOL_STATE;
  }
  return row.state;
}
