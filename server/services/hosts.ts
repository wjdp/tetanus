import { eq, inArray, max } from "drizzle-orm";
import {
  type CollectorStatus,
  collectorStatus,
  MIN_COLLECTOR_VERSION,
} from "#shared/collector";
import type { HostPatch } from "#shared/schemas/hosts";
import { db } from "~~/server/database/client";
import { collectorRun, host } from "~~/server/database/schema";
import { addAutoEvent } from "~~/server/services/diary";
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

function collectorStatusTitle(to: CollectorStatus, version: string) {
  switch (to) {
    case "incompatible":
      return `Collector ${version} incompatible (needs ${MIN_COLLECTOR_VERSION})`;
    case "outdated":
      return `Collector ${version} outdated`;
    default:
      return `Collector ${version} current`;
  }
}

function isFirstSighting(from: CollectorStatus, to: CollectorStatus) {
  return from === "unknown" && to !== "incompatible";
}

export function recordCollectorVersion(
  hostRow: HostRow,
  version: string,
  at = new Date(),
) {
  const from = hostRow.collectorStatus;
  const to = collectorStatus(version);
  db.update(host)
    .set({ collectorVersion: version, collectorStatus: to })
    .where(eq(host.id, hostRow.id))
    .run();
  if (from === to || isFirstSighting(from, to)) return;
  addAutoEvent({
    subjectType: "host",
    subjectId: hostRow.id,
    eventType: "collector-status-changed",
    title: collectorStatusTitle(to, version),
    data: { from, to, version, minVersion: MIN_COLLECTOR_VERSION },
    at,
  });
}
