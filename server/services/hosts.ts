import { eq, inArray, max } from "drizzle-orm";
import type { HostPatch } from "#shared/schemas/hosts";
import { db } from "~~/server/database/client";
import { collectorRun, host } from "~~/server/database/schema";
import { notFound } from "~~/server/utils/serviceError";

type HostRow = typeof host.$inferSelect;

export interface LastCollectorRun {
  receivedAt: Date;
  ok: boolean;
  error: string | null;
  device: string | null;
}

export interface HostWithRuns extends HostRow {
  lastRuns: Record<string, LastCollectorRun>;
}

export function upsertHostByName(name: string, seenAt = new Date()): HostRow {
  return db
    .insert(host)
    .values({ name, firstSeenAt: seenAt, lastSeenAt: seenAt })
    .onConflictDoUpdate({ target: host.name, set: { lastSeenAt: seenAt } })
    .returning()
    .get();
}

function latestRunIds(hostId?: number) {
  const latest = db
    .select({ id: max(collectorRun.id) })
    .from(collectorRun)
    .groupBy(collectorRun.hostId, collectorRun.source);
  return hostId === undefined
    ? latest
    : latest.where(eq(collectorRun.hostId, hostId));
}

function lastRunsByHost(hostId?: number) {
  const runs = db
    .select()
    .from(collectorRun)
    .where(inArray(collectorRun.id, latestRunIds(hostId)))
    .all();
  const byHost = new Map<number, Record<string, LastCollectorRun>>();
  for (const run of runs) {
    const lastRuns = byHost.get(run.hostId) ?? {};
    lastRuns[run.source] = {
      receivedAt: run.receivedAt,
      ok: run.ok,
      error: run.error,
      device: run.device,
    };
    byHost.set(run.hostId, lastRuns);
  }
  return byHost;
}

export function listHosts(): HostWithRuns[] {
  const lastRuns = lastRunsByHost();
  return db
    .select()
    .from(host)
    .orderBy(host.name)
    .all()
    .map((row) => ({ ...row, lastRuns: lastRuns.get(row.id) ?? {} }));
}

export function getHost(id: number): HostWithRuns {
  const row = db.select().from(host).where(eq(host.id, id)).get();
  if (!row) throw notFound(`Host ${id} not found`);
  return { ...row, lastRuns: lastRunsByHost(id).get(id) ?? {} };
}

export function updateHost(id: number, patch: HostPatch): HostWithRuns {
  if (Object.keys(patch).length > 0) {
    const updated = db
      .update(host)
      .set(patch)
      .where(eq(host.id, id))
      .returning({ id: host.id })
      .get();
    if (!updated) throw notFound(`Host ${id} not found`);
  }
  return getHost(id);
}

export function setToolVersions(
  hostId: number,
  toolVersions: Record<string, string>,
) {
  db.update(host).set({ toolVersions }).where(eq(host.id, hostId)).run();
}
