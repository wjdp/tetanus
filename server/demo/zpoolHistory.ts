import { forkRng } from "./prng";
import { DAY_MS } from "./timeline";
import type { HostModel, PoolModel } from "./types";
import type { DemoWorld } from "./world";
import { hostPoolsAt, txgAt } from "./zfsCommon";
import { type SnapshotActivity, snapshotActivity } from "./zfsDatasets";

/** The collector pipes each pool's `zpool history -il` through `tail -n 500`. */
export const HISTORY_TAIL_LINES = 500;

const INITIAL_WINDOW_MS = 2 * DAY_MS;

const ms = (date: Date) => date.getTime();
const pad = (value: number) => String(value).padStart(2, "0");

function timestamp(at: Date) {
  return `${at.toISOString().slice(0, 10)}.${pad(at.getUTCHours())}:${pad(at.getUTCMinutes())}:${pad(at.getUTCSeconds())}`;
}

interface HistoryItem {
  at: Date;
  lines: string[];
}

function writer(host: HostModel, pool: PoolModel) {
  const internal = (at: Date, text: string) =>
    `${timestamp(at)} [txg:${txgAt(pool, at)}] ${text}   [on ${host.name}]`;
  const command = (at: Date, text: string) =>
    `${timestamp(at)} ${text} [user 0 (root) on ${host.name}:linux]`;
  return { internal, command };
}

const datasetId = (name: string) => forkRng(`dsid:${name}`).int(260, 61_000);

function snapshotItem(
  host: HostModel,
  pool: PoolModel,
  world: DemoWorld,
  activity: SnapshotActivity,
): HistoryItem {
  const { internal, command } = writer(host, pool);
  const { at, dataset } = activity;
  if (activity.action === "receive") {
    const partial = `${dataset}/%recv`;
    const snap = activity.snapshot ? ` snap=${activity.snapshot}` : "";
    return {
      at,
      lines: [
        internal(at, `receive ${partial} (${datasetId(partial)})`),
        internal(
          at,
          `finish receiving ${partial} (${datasetId(partial)})${snap}`,
        ),
        command(at, `zfs receive -s -F ${dataset}`),
      ],
    };
  }
  const full = `${dataset}@${activity.snapshot}`;
  const autoSnap =
    world.fleet.datasets[host.name].find(
      (candidate) => candidate.name === dataset,
    )?.snapshots?.style === "zfs-auto-snap";
  const invocation =
    activity.action === "snapshot"
      ? autoSnap
        ? `zfs snapshot -o com.sun:auto-snapshot-desc=- ${full}`
        : `zfs snapshot ${full}`
      : autoSnap
        ? `zfs destroy -d ${full}`
        : `zfs destroy ${full}`;
  return {
    at,
    lines: [
      internal(at, `${activity.action} ${full} (${datasetId(full)})`),
      command(at, invocation),
    ],
  };
}

function poolItems(
  world: DemoWorld,
  host: HostModel,
  pool: PoolModel,
  from: Date,
  t: Date,
): HistoryItem[] {
  const { internal, command } = writer(host, pool);
  const inWindow = (at: Date) => ms(at) > ms(from) && ms(at) <= ms(t);
  const commands = world.stories
    .poolHistory(host.name, t)
    .filter((event) => event.pool === pool.name && inWindow(event.at))
    .map(
      (event): HistoryItem => ({
        at: event.at,
        lines: [
          ...(event.command.startsWith("zpool create")
            ? [
                internal(
                  event.at,
                  `create pool version 5000; software version ${host.zfsVersion}; uts ${host.name} ${host.kernel} #1 SMP x86_64`,
                ),
              ]
            : []),
          command(event.at, event.command),
        ],
      }),
    );
  const scans = world.stories
    .scansBetween(pool, pool.createdAt, t)
    .flatMap((scan): HistoryItem[] => [
      {
        at: scan.start,
        lines: [
          internal(
            scan.start,
            `scan setup func=${scan.function === "SCRUB" ? 1 : 2} mintxg=${scan.function === "SCRUB" ? 0 : 3} maxtxg=${txgAt(pool, scan.start)}`,
          ),
        ],
      },
      { at: scan.end, lines: [internal(scan.end, "scan done errors=0")] },
    ])
    .filter((item) => inWindow(item.at));
  const snapshots = snapshotActivity(world, host, pool, from, t).map(
    (activity) => snapshotItem(host, pool, world, activity),
  );
  return [...scans, ...commands, ...snapshots].sort(
    (a, b) => ms(a.at) - ms(b.at),
  );
}

function poolLines(
  world: DemoWorld,
  host: HostModel,
  pool: PoolModel,
  from: Date,
  t: Date,
) {
  return poolItems(world, host, pool, from, t).flatMap((item) => item.lines);
}

/** One pool's `zpool history -il <pool>` piped through `tail -n 500`. */
function poolTail(
  world: DemoWorld,
  host: HostModel,
  pool: PoolModel,
  t: Date,
): string[] {
  for (let window = INITIAL_WINDOW_MS; ; window *= 4) {
    const from = new Date(ms(t) - window);
    const complete = ms(from) < ms(pool.createdAt);
    const lines = poolLines(world, host, pool, from, t);
    if (complete || lines.length >= HISTORY_TAIL_LINES) {
      return lines.slice(-HISTORY_TAIL_LINES);
    }
  }
}

const header = (pool: PoolModel) => `History for '${pool.name}':`;

const RECEIVE_LINE = /finish receiving |zfs (recv|receive) /;

/** The collector greps each pool's whole history for receives and keeps the last 2000. */
export const RECEIVES_TAIL_LINES = 2000;
const RECEIVES_WINDOW_MS = 14 * DAY_MS;

export function renderZpoolHistory(
  world: DemoWorld,
  host: HostModel,
  t: Date,
): string {
  return `${hostPoolsAt(world, host, t)
    .flatMap((pool) => [header(pool), ...poolTail(world, host, pool, t)])
    .join("\n")}\n`;
}

export function renderZfsReceives(
  world: DemoWorld,
  host: HostModel,
  t: Date,
): string {
  const from = new Date(ms(t) - RECEIVES_WINDOW_MS);
  return `${hostPoolsAt(world, host, t)
    .flatMap((pool) => [
      header(pool),
      ...poolLines(world, host, pool, from, t)
        .filter((line) => RECEIVE_LINE.test(line))
        .slice(-RECEIVES_TAIL_LINES),
    ])
    .join("\n")}\n`;
}
