import { and, eq, inArray, max } from "drizzle-orm";
import {
  type CollectorStatus,
  collectorStatus,
  MIN_COLLECTOR_VERSION,
} from "#shared/collector";
import { unsupportedTools } from "#shared/hostTools";
import type { HostPatch } from "#shared/schemas/hosts";
import { db } from "~~/server/database/client";
import { collectorRun, host } from "~~/server/database/schema";
import { addAutoEvent } from "~~/server/services/diary";
import { invalidRequest, notFound } from "~~/server/utils/serviceError";

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

const DISK_SIGHTING_SOURCES = ["lsblk", "smartctl-scan"];

// When each host last looked for its disks. Disk state is judged as of then,
// so a host that stops reporting does not age its disks.
export function diskSightingTimes(): Map<number, Date> {
  const rows = db
    .select({ hostId: collectorRun.hostId, at: max(collectorRun.receivedAt) })
    .from(collectorRun)
    .where(
      and(
        eq(collectorRun.ok, true),
        inArray(collectorRun.source, DISK_SIGHTING_SOURCES),
      ),
    )
    .groupBy(collectorRun.hostId)
    .all();
  return new Map(
    rows.flatMap(({ hostId, at }) => (at ? [[hostId, at] as const] : [])),
  );
}

export function listHosts(): HostWithRuns[] {
  const lastRuns = lastRunsByHost();
  return db
    .select()
    .from(host)
    .orderBy(host.position, host.name)
    .all()
    .map((row) => ({ ...row, lastRuns: lastRuns.get(row.id) ?? {} }));
}

export function getHost(id: number): HostWithRuns {
  const row = db.select().from(host).where(eq(host.id, id)).get();
  if (!row) throw notFound(`Host ${id} not found`);
  return { ...row, lastRuns: lastRunsByHost(id).get(id) ?? {} };
}

export function getHostByName(name: string): HostWithRuns {
  const row = db.select().from(host).where(eq(host.name, name)).get();
  if (!row) throw notFound(`Host ${name} not found`);
  return { ...row, lastRuns: lastRunsByHost(row.id).get(row.id) ?? {} };
}

function withIntermittentRule(current: HostRow, patch: HostPatch): HostPatch {
  if (patch.intermittent === true && !current.intermittent) {
    return { healthchecksUrl: null, ...patch };
  }
  const intermittent = patch.intermittent ?? current.intermittent;
  const healthchecksUrl =
    patch.healthchecksUrl === undefined
      ? current.healthchecksUrl
      : patch.healthchecksUrl;
  if (intermittent && healthchecksUrl !== null) {
    throw invalidRequest("An intermittent host cannot have a Healthchecks URL");
  }
  return patch;
}

export function updateHost(id: number, patch: HostPatch): HostWithRuns {
  const current = db.select().from(host).where(eq(host.id, id)).get();
  if (!current) throw notFound(`Host ${id} not found`);
  const changes = withIntermittentRule(current, patch);
  if (Object.keys(changes).length > 0) {
    db.update(host).set(changes).where(eq(host.id, id)).run();
  }
  return getHost(id);
}

export function reorderHosts(hostIds: number[]): HostWithRuns[] {
  const known = db.select({ id: host.id }).from(host).all();
  const requested = new Set(hostIds);
  const isFullList =
    requested.size === known.length &&
    known.every((row) => requested.has(row.id));
  if (!isFullList) {
    throw invalidRequest("Host order must list every host exactly once");
  }
  db.transaction((tx) => {
    hostIds.forEach((id, position) => {
      tx.update(host).set({ position }).where(eq(host.id, id)).run();
    });
  });
  return listHosts();
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

// Hosts whose OpenZFS is too old to report pools: their disks' pool
// membership cannot be known (079).
export function poolBlindHostIds(): Set<number> {
  return new Set(
    db
      .select({ id: host.id, toolVersions: host.toolVersions })
      .from(host)
      .all()
      .filter((row) =>
        unsupportedTools(row.toolVersions).some(
          (unsupported) => unsupported.tool === "openzfs",
        ),
      )
      .map((row) => row.id),
  );
}
