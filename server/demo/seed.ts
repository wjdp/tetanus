import { and, desc, eq, gte, isNull, max } from "drizzle-orm";
import { COLLECTOR_VERSION } from "#shared/collector";
import type { DiarySubjectType } from "#shared/diary";
import type { IngestSource } from "#shared/ingest";
import { db } from "~~/server/database/client";
import {
  collectorRun,
  diaryEntry,
  fault,
  host as hostTable,
  notification,
  pool as poolTable,
} from "~~/server/database/schema";
import { acceptFault } from "~~/server/services/acceptance";
import { alertContext } from "~~/server/services/alerts/dispatch";
import { type Alert, deriveAlert } from "~~/server/services/alerts/rules";
import { addManualEntry } from "~~/server/services/diary";
import {
  findDiskByKey,
  listDisks,
  PRESENT_WINDOW_MS,
  updateDisk,
} from "~~/server/services/disks";
import { performFaultAction, syncFaults } from "~~/server/services/faults";
import { reorderHosts, updateHost } from "~~/server/services/hosts";
import { recordIngest } from "~~/server/services/ingest";
import { ensureSettings, setAlertCursor } from "~~/server/services/settings";
import { renderSmart } from "./smart";
import { addMs, DAY_MS, HOUR_MS, resetAnchor } from "./timeline";
import type {
  DiskModel,
  FaultActionSeed,
  HostModel,
  HostName,
  HostPayload,
  NotificationSeed,
  SeedSubject,
} from "./types";
import { createWorld, type DemoWorld } from "./world";
import { renderZfs } from "./zfs";

export const demoProducer = (host: HostModel) =>
  `tetanus-collect/${host.collectorVersion ?? COLLECTOR_VERSION}`;

const DAILY_FOR_MS = 90 * DAY_MS;

/**
 * `full` is the reset schedule: hourly for a day and every third day to 90 d keeps the
 * 7 d and 30 d trend windows populated at a quarter of 034's original post count.
 * `short` keeps every story instant but samples weekly and quarterly, with three hourly
 * runs, for tests that cannot afford a full replay.
 */
const REPLAY_GRIDS = {
  full: { hourlyRuns: 24, dailyStepDays: 3, monthStep: 1 },
  short: { hourlyRuns: 3, dailyStepDays: 7, monthStep: 3 },
} as const;

export type ReplayDensity = keyof typeof REPLAY_GRIDS;

export interface SeedOptions {
  replay?: ReplayDensity;
}

export type IngestCounts = Partial<Record<IngestSource, number>>;

/** Posts per source and the milliseconds spent rendering and ingesting them. */
export interface IngestTally {
  count: IngestCounts;
  renderMs: number;
  ingestMs: Partial<Record<IngestSource, number>>;
}

export interface SeedProgress {
  done: number;
  total: number;
  at: Date | null;
}

export interface SeedReport {
  anchor: Date;
  at: Date;
  instants: number;
  ingests: IngestTally;
  failures: string[];
  notifications: number;
  durationMs: number;
}

export interface TickReport {
  at: Date;
  ingests: IngestTally;
  failures: string[];
  /** Hosts that already had a collector run this hour. */
  skipped: HostName[];
}

const ms = (date: Date) => date.getTime();

export function floorToHour(date: Date): Date {
  return new Date(ms(date) - (ms(date) % HOUR_MS));
}

interface ReplayInstant {
  at: Date;
  /** `smartctl-xall` for every present disk, or only for these (disks installed at this instant). */
  xall: "all" | Set<DiskModel>;
}

type ReplayAction = { at: Date; apply: () => unknown };

function ingestTally() {
  const tally: IngestTally = { count: {}, renderMs: 0, ingestMs: {} };
  const failures: string[] = [];
  function ingest(host: HostModel, render: () => HostPayload[], at: Date) {
    const renderStartedAt = performance.now();
    const payloads = render();
    tally.renderMs += performance.now() - renderStartedAt;
    for (const { source, meta, body } of payloads) {
      const startedAt = performance.now();
      const outcome = recordIngest({
        hostName: host.name,
        source,
        meta,
        body,
        producer: demoProducer(host),
        receivedAt: at,
      });
      tally.ingestMs[source] =
        (tally.ingestMs[source] ?? 0) + performance.now() - startedAt;
      tally.count[source] = (tally.count[source] ?? 0) + 1;
      if (!outcome.ok) {
        failures.push(
          `${host.name} ${source} at ${at.toISOString()}: ${outcome.error}`,
        );
      }
    }
  }
  const rounded = (): IngestTally => ({
    count: tally.count,
    renderMs: Math.round(tally.renderMs),
    ingestMs: Object.fromEntries(
      Object.entries(tally.ingestMs).map(([source, spent]) => [
        source,
        Math.round(spent),
      ]),
    ),
  });
  return { tally: rounded, failures, ingest };
}

function monthsBack(from: Date, months: number): Date {
  const at = new Date(from);
  at.setUTCMonth(at.getUTCMonth() - months);
  return at;
}

/** Monthly to `now − 90 d`, every third day to `now − 48 h`, hourly for the last day. */
function gridInstants(
  world: DemoWorld,
  lastHour: Date,
  density: ReplayDensity,
): Date[] {
  const { hourlyRuns, dailyStepDays, monthStep } = REPLAY_GRIDS[density];
  const earliest = Math.min(
    ...world.fleet.hosts.map((host) => ms(host.installedAt)),
  );
  const instants: Date[] = [];
  for (let hours = 0; hours < hourlyRuns; hours++) {
    instants.push(addMs(lastHour, -hours * HOUR_MS));
  }
  for (let days = 2; days <= DAILY_FOR_MS / DAY_MS; days += dailyStepDays) {
    instants.push(addMs(lastHour, -days * DAY_MS));
  }
  const dailyFrom = ms(lastHour) - DAILY_FOR_MS;
  for (let months = monthStep; ; months += monthStep) {
    const at = monthsBack(lastHour, months);
    if (ms(at) < earliest) break;
    if (ms(at) < dailyFrom) instants.push(at);
  }
  return instants;
}

/**
 * Every instant the replay ingests at. Grid and story instants post everything; ZFS
 * instants (installs, removals, scans, faults) post the identity sources and ZFS, plus
 * `smartctl-xall` for disks installed then. Each removal gets a run a minute before
 * the pull and one after the present window, so a pulled disk goes missing when the
 * collector would first have noticed, not at the previous sparse sample.
 */
function replayInstants(
  world: DemoWorld,
  lastHour: Date,
  density: ReplayDensity,
): ReplayInstant[] {
  const { timeline, fleet, stories } = world;
  const byTime = new Map<number, ReplayInstant>();
  const add = (at: Date, xall: ReplayInstant["xall"]) => {
    if (ms(at) > ms(lastHour)) return;
    const existing = byTime.get(ms(at));
    if (!existing) {
      byTime.set(ms(at), { at, xall });
    } else if (existing.xall !== "all") {
      if (xall === "all") existing.xall = "all";
      else for (const disk of xall) existing.xall.add(disk);
    }
  };
  for (const at of gridInstants(world, lastHour, density)) add(at, "all");
  for (const at of Object.values(timeline)) {
    if (at !== timeline.anchor) add(at, "all");
  }
  for (const at of stories.zfsInstants) add(at, new Set());
  for (const disk of fleet.disks) {
    add(disk.installedAt, new Set([disk]));
    if (disk.removedAt) {
      add(addMs(disk.removedAt, -60_000), new Set());
      add(
        floorToHour(addMs(disk.removedAt, PRESENT_WINDOW_MS + HOUR_MS)),
        new Set(),
      );
    }
  }
  return [...byTime.values()].sort((a, b) => ms(a.at) - ms(b.at));
}

const isSwitchedOff = (host: HostModel, at: Date) =>
  host.lastRunAt !== undefined && ms(at) > ms(host.lastRunAt);

const isHostsLastRun = (host: HostModel, at: Date) =>
  host.lastRunAt !== undefined && ms(at) === ms(host.lastRunAt);

function hostPayloadsAt(
  world: DemoWorld,
  host: HostModel,
  at: Date,
  xall: ReplayInstant["xall"],
  datasets: boolean,
): HostPayload[] {
  return [
    ...renderSmart(world, host, at, {
      xallFor: (disk) => xall === "all" || xall.has(disk),
    }),
    ...renderZfs(world, host, at, { datasets }),
  ];
}

/**
 * Sources whose handler leaves the database as it was when the body repeats.
 * `smartctl-scan` is not among them: its run time is when the host last looked
 * for its disks, which disk state is judged against.
 */
const IDEMPOTENT_SOURCES = new Set<IngestSource>([
  "versions",
  "vdev-id-conf",
  "lsblk",
  "udev",
]);
const HISTORY_HEADER = /^History for '[^']+':$/;
const HISTORY_TIMESTAMP = /^\d{4}-\d{2}-\d{2}\.\d{2}:\d{2}:\d{2} /;

/**
 * Drops `zpool history` entries this host has already posted, keeping the pool
 * headers; null when nothing is new. The ingest upserts on (host, at, text), so
 * posting only new entries leaves the same rows as posting the whole tail.
 */
function unseenHistory(body: string, seen: Set<string>): string | null {
  const kept: string[] = [];
  let entry: string[] = [];
  let fresh = false;
  const flush = () => {
    const key = entry.join("\n");
    if (entry.length > 0 && !seen.has(key)) {
      seen.add(key);
      kept.push(...entry);
      fresh = true;
    }
    entry = [];
  };
  for (const line of body.split("\n")) {
    if (HISTORY_HEADER.test(line)) {
      flush();
      kept.push(line);
    } else if (HISTORY_TIMESTAMP.test(line)) {
      flush();
      entry = [line];
    } else if (entry.length > 0) {
      entry.push(line);
    } else {
      kept.push(line);
    }
  }
  flush();
  return fresh ? kept.join("\n") : null;
}

/**
 * The replay posts hundreds of runs; bodies that would change nothing are left out
 * (identity sources that repeat, history entries already posted). Presence still
 * refreshes every run: `udev` is only dropped when `smartctl-xall` covers every disk.
 * The last run posts everything, so each source's latest payload is a full one.
 */
function replayTrimmer() {
  const lastBodies = new Map<string, string>();
  const seenHistory = new Map<HostName, Set<string>>();
  return (
    hostName: HostName,
    payloads: HostPayload[],
    { xallForAll, isLast }: { xallForAll: boolean; isLast: boolean },
  ): HostPayload[] =>
    payloads.flatMap((posted): HostPayload[] => {
      const seen = seenHistory.get(hostName) ?? new Set<string>();
      seenHistory.set(hostName, seen);
      if (posted.source === "zpool-history") {
        const unseen = unseenHistory(posted.body, seen);
        if (isLast) return [posted];
        return unseen === null ? [] : [{ ...posted, body: unseen }];
      }
      if (!IDEMPOTENT_SOURCES.has(posted.source)) return [posted];
      const key = `${hostName}|${posted.source}|${posted.meta.device ?? ""}`;
      const repeated = lastBodies.get(key) === posted.body;
      lastBodies.set(key, posted.body);
      const mayDrop = posted.source !== "udev" || xallForAll;
      return repeated && mayDrop && !isLast ? [] : [posted];
    });
}

function diskIdOf(disk: DiskModel): number {
  const row = findDiskByKey("model-serial", `${disk.model}|${disk.serial}`);
  if (!row) throw new Error(`Demo disk ${disk.alias} was never ingested`);
  return row.id;
}

function hostIdOf(name: HostName): number {
  const row = db
    .select({ id: hostTable.id })
    .from(hostTable)
    .where(eq(hostTable.name, name))
    .get();
  if (!row) throw new Error(`Demo host ${name} was never ingested`);
  return row.id;
}

function poolIdOf(world: DemoWorld, hostName: HostName, name: string): number {
  const { guid } = world.stories.pool(hostName, name);
  const row = db
    .select({ id: poolTable.id })
    .from(poolTable)
    .where(eq(poolTable.guid, guid))
    .get();
  if (!row) throw new Error(`Demo pool ${hostName}/${name} was never ingested`);
  return row.id;
}

function resolveSubject(
  world: DemoWorld,
  subject: SeedSubject,
): { subjectType: DiarySubjectType; subjectId: number | null } {
  switch (subject.type) {
    case "disk":
      return {
        subjectType: "disk",
        subjectId: diskIdOf(world.stories.disk(subject.alias)),
      };
    case "pool":
      return {
        subjectType: "pool",
        subjectId: poolIdOf(world, subject.host, subject.pool),
      };
    case "host":
      return { subjectType: "host", subjectId: hostIdOf(subject.host) };
    case "system":
      return { subjectType: "system", subjectId: null };
  }
}

/** The kind fixes the subject type, so the subject's id picks the fault. */
function liveFaultIdOf(
  world: DemoWorld,
  { subject, kind }: FaultActionSeed,
): number {
  const { subjectId } = resolveSubject(world, subject);
  const row =
    subjectId === null
      ? undefined
      : db
          .select({ id: fault.id })
          .from(fault)
          .where(
            and(
              eq(fault.kind, kind),
              eq(fault.subjectId, subjectId),
              isNull(fault.resolvedAt),
            ),
          )
          .get();
  if (!row)
    throw new Error(`No live ${kind} fault on ${subject.type} ${subjectId}`);
  return row.id;
}

function replayActions(world: DemoWorld): ReplayAction[] {
  const { seeds, disk } = world.stories;
  return [
    ...seeds.acceptances.map(
      ({ alias, attrId, kind, note, at }): ReplayAction => ({
        at,
        apply: () =>
          acceptFault({
            diskId: diskIdOf(disk(alias)),
            attrId,
            kind,
            note,
            now: at,
          }),
      }),
    ),
    ...seeds.faultActions.map(
      (seed): ReplayAction => ({
        at: seed.at,
        apply: () =>
          performFaultAction(liveFaultIdOf(world, seed), seed.action, {
            note: seed.note,
            now: seed.at,
          }),
      }),
    ),
    ...seeds.overrides.map(
      ({ alias, stateOverride, notes, at }): ReplayAction => ({
        at,
        apply: () =>
          updateDisk(
            diskIdOf(disk(alias)),
            { stateOverride, ...(notes !== undefined && { notes }) },
            at,
          ),
      }),
    ),
  ];
}

/** The auto diary entry the real rule would have alerted on, nearest the story's instant. */
function storyAlert(world: DemoWorld, seed: NotificationSeed): Alert | null {
  const { subjectType, subjectId } = resolveSubject(world, seed.subject);
  if (subjectId === null) return null;
  const context = alertContext();
  const candidates = db
    .select()
    .from(diaryEntry)
    .where(
      and(
        eq(diaryEntry.kind, "auto"),
        eq(diaryEntry.subjectType, subjectType),
        eq(diaryEntry.subjectId, subjectId),
        eq(diaryEntry.eventType, seed.eventType),
      ),
    )
    .orderBy(desc(diaryEntry.at))
    .all()
    .flatMap((entry) => {
      const alert = deriveAlert(entry, context);
      return alert?.rule === seed.rule ? [alert] : [];
    });
  const distance = (alert: Alert) => Math.abs(ms(alert.at) - ms(seed.at));
  return candidates.sort((a, b) => distance(a) - distance(b)).at(0) ?? null;
}

function insertStoryNotifications(world: DemoWorld): number {
  const alerts = world.stories.seeds.notifications.flatMap(
    (seed) => storyAlert(world, seed) ?? [],
  );
  for (const alert of alerts) {
    db.insert(notification)
      .values({
        at: alert.at,
        channel: "pushover",
        rule: alert.rule,
        dedupeKey: alert.dedupeKey,
        subject: alert.subject,
        title: alert.title,
        message: alert.message,
        ok: true,
        error: null,
        diaryEntryId: alert.diaryEntryId,
      })
      .run();
  }
  return alerts.length;
}

async function applyFinishingTouches(world: DemoWorld, now: Date) {
  const { fleet, stories } = world;
  const { seeds } = stories;
  await syncFaults(now, await listDisks(now));
  for (const host of fleet.hosts) {
    updateHost(hostIdOf(host.name), {
      displayName: seeds.hostDisplayNames[host.name],
      notes: seeds.hostNotes[host.name],
    });
  }
  reorderHosts(fleet.hosts.map((host) => hostIdOf(host.name)));
  for (const disk of fleet.disks) {
    const aliasFromConf = stories.host(disk.host).vdevIdConf;
    await updateDisk(
      diskIdOf(disk),
      {
        inventory: disk.inventory,
        ...(!aliasFromConf && { alias: disk.alias }),
      },
      now,
    );
  }
  for (const entry of seeds.manualDiary) {
    addManualEntry({
      ...resolveSubject(world, entry.subject),
      title: entry.title,
      body: entry.body,
      at: entry.at,
    });
  }
}

function lastDiaryId(): number {
  return (
    db
      .select({ id: max(diaryEntry.id) })
      .from(diaryEntry)
      .get()?.id ?? 0
  );
}

/**
 * The replay as small units of work (one instant each), so a caller with a CPU or
 * wall-clock budget can drain it across several turns and then call `finishSeed`,
 * inside `holdAlertsQueue`. `seed` does all three in one go.
 */
export async function* seedSteps(
  now: Date,
  { replay = "full" }: SeedOptions = {},
): AsyncGenerator<SeedProgress, SeedReport, void> {
  const startedAt = performance.now();
  const world = createWorld(resetAnchor(now));
  const lastHour = floorToHour(now);
  const instants = replayInstants(world, lastHour, replay);
  const actions = replayActions(world)
    .filter((action) => ms(action.at) <= ms(lastHour))
    .sort((a, b) => ms(a.at) - ms(b.at));
  const total = instants.length;
  const { tally, failures, ingest } = ingestTally();
  const trim = replayTrimmer();

  ensureSettings();
  setAlertCursor(Number.MAX_SAFE_INTEGER);

  const markedIntermittent = new Set<HostName>();
  const markIntermittentOnFirstRun = (host: HostModel) => {
    if (!host.intermittent || markedIntermittent.has(host.name)) return;
    updateHost(hostIdOf(host.name), { intermittent: true });
    markedIntermittent.add(host.name);
  };

  let pendingAction = 0;
  const applyActionsUntil = async (at: Date) => {
    for (; pendingAction < actions.length; pendingAction++) {
      const action = actions[pendingAction] as ReplayAction;
      if (ms(action.at) > ms(at)) return;
      await action.apply();
    }
  };

  for (const [index, instant] of instants.entries()) {
    await applyActionsUntil(addMs(instant.at, -1));
    const isLast = index === instants.length - 1;
    for (const host of world.fleet.hosts) {
      if (ms(host.installedAt) > ms(instant.at)) continue;
      if (isSwitchedOff(host, instant.at)) continue;
      const isHostsLast = isLast || isHostsLastRun(host, instant.at);
      ingest(
        host,
        () =>
          trim(
            host.name,
            hostPayloadsAt(world, host, instant.at, instant.xall, isHostsLast),
            { xallForAll: instant.xall === "all", isLast: isHostsLast },
          ),
        instant.at,
      );
      markIntermittentOnFirstRun(host);
    }
    await syncFaults(instant.at, await listDisks(instant.at));
    yield { done: index + 1, total, at: instant.at };
  }
  await applyActionsUntil(lastHour);

  return {
    anchor: world.timeline.anchor,
    at: lastHour,
    instants: instants.length,
    ingests: tally(),
    failures,
    notifications: 0,
    durationMs: Math.round(performance.now() - startedAt),
  };
}

/** Finishing steps after `seedSteps` is drained: services with backdated `at`, story alerts, alert cursor. */
export async function finishSeed(
  now: Date,
  replay: SeedReport,
): Promise<SeedReport> {
  const startedAt = performance.now();
  const world = createWorld(resetAnchor(now));
  await applyFinishingTouches(world, now);
  const notifications = insertStoryNotifications(world);
  setAlertCursor(lastDiaryId());
  return {
    ...replay,
    notifications,
    durationMs: replay.durationMs + Math.round(performance.now() - startedAt),
  };
}

/**
 * Replays the demo fleet's history into an empty database through `recordIngest`
 * (see 034 "Replay schedule at reset"). The alert cursor is held past every entry
 * while replaying and left at the last one, so no alert pass replays the history.
 */
export async function seed(
  now: Date,
  options: SeedOptions = {},
): Promise<SeedReport> {
  const restoreAlertsQueue = await holdAlertsQueue();
  try {
    const steps = seedSteps(now, options);
    let step = await steps.next();
    while (!step.done) step = await steps.next();
    return await finishSeed(now, step.value);
  } finally {
    await restoreAlertsQueue();
  }
}

/** One collector run per host at the top of `now`'s hour; hosts that already have one this hour are skipped. */
export async function tick(now: Date): Promise<TickReport> {
  const at = floorToHour(now);
  const world = createWorld(resetAnchor(now));
  const { tally, failures, ingest } = ingestTally();
  const skipped: HostName[] = [];
  for (const host of world.fleet.hosts) {
    if (isSwitchedOff(host, at)) continue;
    if (hasRunSince(host.name, at)) {
      skipped.push(host.name);
      continue;
    }
    ingest(host, () => hostPayloadsAt(world, host, at, "all", true), at);
  }
  await syncFaults(at, await listDisks(at));
  return { at, ingests: tally(), failures, skipped };
}

function hasRunSince(hostName: HostName, at: Date): boolean {
  return (
    db
      .select({ id: collectorRun.id })
      .from(collectorRun)
      .innerJoin(hostTable, eq(hostTable.id, collectorRun.hostId))
      .where(
        and(eq(hostTable.name, hostName), gte(collectorRun.receivedAt, at)),
      )
      .limit(1)
      .get() !== undefined
  );
}

const ALERTS_HOLD_KEY = "task:0";

/**
 * `recordIngest` asks for an alerts pass after every post. Each replay instant posts
 * dozens back to back; those requests would all find the queue empty once they resume
 * and each enqueue a pass, so a pending `alerts:tick` placeholder (never made current,
 * so never run) is parked in the queue meanwhile. Without Nitro storage (CLI, unit
 * tests) the request fails fast on its own and there is nothing to hold.
 */
export async function holdAlertsQueue(): Promise<() => Promise<void>> {
  if (typeof useStorage !== "function") return async () => {};
  const storage = useStorage();
  await storage.setItem(ALERTS_HOLD_KEY, {
    id: 0,
    name: "alerts:tick",
    state: "pending",
  });
  return async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
    await storage.removeItem(ALERTS_HOLD_KEY);
  };
}
