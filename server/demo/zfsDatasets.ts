import { REPLICATION_DAILY_AT_UTC, snapshotGuid } from "./fleet";
import { forkRng } from "./prng";
import { addMs, DAY_MS, HOUR_MS } from "./timeline";
import type {
  DatasetModel,
  HostModel,
  PoolModel,
  SnapshotPolicy,
  SnapshotStyle,
} from "./types";
import type { DemoWorld } from "./world";
import {
  bigInt,
  DEFAULT_SOURCE,
  epochSeconds,
  hostPoolsAt,
  jsonWithBigInts,
  LOCAL_SOURCE,
  NO_SOURCE,
  type PropertySource,
  property,
  txgAt,
} from "./zfsCommon";
import { poolTopology } from "./zpoolStatus";

type SnapshotKind = "hourly" | "daily" | "monthly";

const KINDS: SnapshotKind[] = ["monthly", "daily", "hourly"];

const MINUTE_MS = 60_000;
const SLOP_FRACTION = 1 / 32;
const USED_BY_SNAPSHOTS_OVERLAP = 1.4;
const ZVOL_REFRESERVATION_OVERHEAD = 1.016;

const ms = (date: Date) => date.getTime();
const pad = (value: number) => String(value).padStart(2, "0");

/** Schedule clock (UTC) of each kind: sanoid on the hour and midnight, zfs-auto-snapshot's cron minutes. */
const SCHEDULE: Record<
  SnapshotStyle,
  Record<SnapshotKind, { hour: number; minute: number }>
> = {
  sanoid: {
    hourly: { hour: 0, minute: 0 },
    daily: { hour: 0, minute: 0 },
    monthly: { hour: 0, minute: 0 },
  },
  "zfs-auto-snap": {
    hourly: { hour: 0, minute: 17 },
    daily: { hour: 6, minute: 25 },
    monthly: { hour: 6, minute: 52 },
  },
};

function latestInstant(style: SnapshotStyle, kind: SnapshotKind, t: Date) {
  const { hour, minute } = SCHEDULE[style][kind];
  const at = new Date(t);
  at.setUTCSeconds(0, 0);
  if (kind === "hourly") {
    at.setUTCMinutes(minute);
    if (ms(at) > ms(t)) at.setTime(ms(at) - HOUR_MS);
    return at;
  }
  at.setUTCHours(hour, minute);
  if (kind === "daily") {
    if (ms(at) > ms(t)) at.setTime(ms(at) - DAY_MS);
    return at;
  }
  at.setUTCDate(1);
  if (ms(at) > ms(t)) at.setUTCMonth(at.getUTCMonth() - 1);
  return at;
}

function previousInstant(kind: SnapshotKind, at: Date): Date {
  if (kind === "hourly") return addMs(at, -HOUR_MS);
  if (kind === "daily") return addMs(at, -DAY_MS);
  const previous = new Date(at);
  previous.setUTCMonth(previous.getUTCMonth() - 1);
  return previous;
}

function snapshotName(style: SnapshotStyle, kind: SnapshotKind, at: Date) {
  const day = at.toISOString().slice(0, 10);
  const hh = pad(at.getUTCHours());
  const mm = pad(at.getUTCMinutes());
  return style === "sanoid"
    ? `autosnap_${day}_${hh}:${mm}:00_${kind}`
    : `zfs-auto-snap_${kind}-${day}-${hh}${mm}`;
}

/** sanoid takes monthly, daily, then hourly in one run; each snapshot lands a few seconds after the scheduled instant. */
function creationOf(
  source: string,
  name: string,
  kind: SnapshotKind,
  at: Date,
) {
  const jitter = forkRng(`snapshot-jitter:${source}@${name}`).int(1, 4);
  return addMs(at, (KINDS.indexOf(kind) * 3 + jitter) * 1000);
}

interface ScheduledSnapshot {
  name: string;
  kind: SnapshotKind;
  creation: Date;
}

/** The newest `count` scheduled snapshots of a kind taken at or before `t`, oldest first. */
function retained(
  source: DatasetModel,
  style: SnapshotStyle,
  kind: SnapshotKind,
  count: number,
  t: Date,
): ScheduledSnapshot[] {
  const kept: ScheduledSnapshot[] = [];
  let at = latestInstant(style, kind, t);
  while (kept.length < count && ms(at) >= ms(source.createdAt)) {
    const name = snapshotName(style, kind, at);
    const creation = creationOf(source.name, name, kind, at);
    if (ms(creation) <= ms(t)) kept.push({ name, kind, creation });
    at = previousInstant(kind, at);
  }
  return kept.reverse();
}

const byCreation = <T extends { creation: Date; name: string }>(a: T, b: T) =>
  ms(a.creation) - ms(b.creation) || (a.name < b.name ? -1 : 1);

function sourceSnapshots(
  source: DatasetModel,
  policy: SnapshotPolicy,
  t: Date,
): ScheduledSnapshot[] {
  return KINDS.flatMap((kind) =>
    retained(source, policy.style, kind, policy[kind], t),
  ).sort(byCreation);
}

export function lastReplication(t: Date): Date {
  const [hour, minute] = REPLICATION_DAILY_AT_UTC.split(":").map(Number);
  const at = new Date(t);
  at.setUTCHours(hour ?? 0, minute ?? 0, 0, 0);
  if (ms(at) > ms(t)) at.setTime(ms(at) - DAY_MS);
  return at;
}

/** The replica's last sync at or before `t`, behind schedule by its lag. */
function lastReplicaSync(replica: DatasetModel, t: Date): Date {
  return addMs(lastReplication(t), -(replica.replicationLagDays ?? 0) * DAY_MS);
}

/** Replicas hold the source's dailies and monthlies up to the sync, pruned to their own retention. */
function replicaSnapshotsAt(
  source: DatasetModel,
  replica: DatasetModel,
  syncedAt: Date,
): ScheduledSnapshot[] {
  const sourcePolicy = source.snapshots;
  const policy = replica.snapshots;
  if (!sourcePolicy || !policy) return [];
  if (ms(syncedAt) < ms(replica.createdAt)) return [];
  return KINDS.filter((kind) => sourcePolicy[kind] > 0)
    .flatMap((kind) =>
      retained(source, sourcePolicy.style, kind, policy[kind], syncedAt),
    )
    .sort(byCreation);
}

// Sizes.

function wobble(dataset: DatasetModel, at: Date) {
  const hourIndex = Math.floor(ms(at) / HOUR_MS);
  return (
    forkRng(`dataset-wobble:${dataset.name}:${hourIndex}`).gaussian(0, 0.04) *
    dataset.churnBytesPerDay
  );
}

function referencedAt(world: DemoWorld, dataset: DatasetModel, at: Date) {
  const { atCreation, atAnchor } = dataset.referencedBytes;
  const span = ms(world.timeline.anchor) - ms(dataset.createdAt);
  const progress = span > 0 ? (ms(at) - ms(dataset.createdAt)) / span : 1;
  const linear = atCreation + (atAnchor - atCreation) * Math.max(0, progress);
  return Math.max(atCreation, Math.round(linear + wobble(dataset, at)));
}

export interface SnapshotAt {
  dataset: string;
  name: string;
  guid: string;
  creation: Date;
  used: number;
  referenced: number;
  written: number;
}

function sizedSnapshots(
  world: DemoWorld,
  dataset: DatasetModel,
  source: DatasetModel,
  scheduled: ScheduledSnapshot[],
): SnapshotAt[] {
  return scheduled.map((snapshot, index) => {
    const referenced = referencedAt(world, source, snapshot.creation);
    const previous = scheduled[index - 1];
    const rng = forkRng(`snapshot-size:${source.name}@${snapshot.name}`);
    const written = previous
      ? Math.min(
          referenced,
          Math.round(
            ((source.churnBytesPerDay *
              (ms(snapshot.creation) - ms(previous.creation))) /
              DAY_MS) *
              rng.next() *
              1.6,
          ),
        )
      : referenced;
    return {
      dataset: dataset.name,
      name: snapshot.name,
      guid: snapshotGuid(source.name, snapshot.name),
      creation: snapshot.creation,
      used: Math.round(
        Math.min(written, source.churnBytesPerDay * 2) *
          (0.02 + rng.next() * 0.3),
      ),
      referenced,
      written,
    };
  });
}

function sourceOf(world: DemoWorld, dataset: DatasetModel): DatasetModel {
  if (!dataset.replicaOf) return dataset;
  return (
    Object.values(world.fleet.datasets)
      .flat()
      .find((candidate) => candidate.name === dataset.replicaOf) ?? dataset
  );
}

export function presentDatasets(
  world: DemoWorld,
  host: HostModel,
  t: Date,
): DatasetModel[] {
  const pools = new Set(hostPoolsAt(world, host, t).map((pool) => pool.name));
  return world.fleet.datasets[host.name].filter(
    (dataset) =>
      ms(dataset.createdAt) <= ms(t) &&
      pools.has(dataset.name.split("/")[0] ?? ""),
  );
}

function datasetSnapshots(
  world: DemoWorld,
  dataset: DatasetModel,
  t: Date,
): SnapshotAt[] {
  const source = sourceOf(world, dataset);
  const scheduled =
    dataset.replicaOf && source !== dataset
      ? replicaSnapshotsAt(source, dataset, lastReplicaSync(dataset, t))
      : dataset.snapshots
        ? sourceSnapshots(dataset, dataset.snapshots, t)
        : [];
  return sizedSnapshots(world, dataset, source, scheduled);
}

export function snapshotsAt(
  world: DemoWorld,
  host: HostModel,
  t: Date,
): SnapshotAt[] {
  return presentDatasets(world, host, t)
    .flatMap((dataset) => datasetSnapshots(world, dataset, t))
    .sort(byCreation);
}

// zfs list -j --json-int -p -t filesystem,volume -o name,type,used,…,encryptionroot

interface Inheritable {
  value: string | number;
  source: PropertySource;
}

function inherit(
  value: string | number,
  parent: Inheritable | undefined,
  parentName: string | null,
  inheritedValue: string | number | undefined,
  defaultValue: string | number,
): Inheritable {
  if (parent && parentName && value === inheritedValue) {
    if (parent.source.type === "DEFAULT")
      return { value, source: DEFAULT_SOURCE };
    const origin =
      parent.source.type === "INHERITED" ? parent.source.data : parentName;
    return { value, source: { type: "INHERITED", data: origin } };
  }
  if (!parent && value === defaultValue) {
    return { value, source: DEFAULT_SOURCE };
  }
  return { value, source: LOCAL_SOURCE };
}

const parentOf = (name: string) =>
  name.includes("/") ? name.slice(0, name.lastIndexOf("/")) : null;

function childMountpoint(parentMount: string, name: string) {
  if (parentMount === "none" || parentMount === "legacy") return parentMount;
  const leaf = name.slice(name.lastIndexOf("/") + 1);
  return parentMount === "/" ? `/${leaf}` : `${parentMount}/${leaf}`;
}

interface DatasetSizes {
  used: number;
  referenced: number;
  logicalUsed: number;
  logicalReferenced: number;
  usedBySnapshots: number;
  usedByChildren: number;
  written: number;
}

function datasetSizes(
  world: DemoWorld,
  datasets: DatasetModel[],
  snapshots: SnapshotAt[],
  t: Date,
): Map<string, DatasetSizes> {
  const sizes = new Map<string, DatasetSizes>();
  const deepestFirst = [...datasets].sort(
    (a, b) => b.name.split("/").length - a.name.split("/").length,
  );
  for (const dataset of deepestFirst) {
    const source = sourceOf(world, dataset);
    const own = snapshots.filter(
      (snapshot) => snapshot.dataset === dataset.name,
    );
    const latest = own.at(-1);
    const referencedTime = dataset.replicaOf
      ? (latest?.creation ?? lastReplication(t))
      : t;
    const referenced = referencedAt(world, source, referencedTime);
    const usedBySnapshots = Math.round(
      own.reduce((sum, snapshot) => sum + snapshot.used, 0) *
        USED_BY_SNAPSHOTS_OVERLAP,
    );
    const children = datasets
      .filter((candidate) => parentOf(candidate.name) === dataset.name)
      .map((child) => sizes.get(child.name))
      .filter((child): child is DatasetSizes => child !== undefined);
    const usedByChildren = children.reduce((sum, child) => sum + child.used, 0);
    const refreservation = dataset.volsize
      ? Math.max(0, dataset.volsize * ZVOL_REFRESERVATION_OVERHEAD - referenced)
      : 0;
    const used = Math.round(
      referenced + usedBySnapshots + usedByChildren + refreservation,
    );
    const written = latest
      ? Math.min(
          referenced,
          (dataset.churnBytesPerDay *
            (ms(referencedTime) - ms(latest.creation))) /
            DAY_MS,
        )
      : referenced;
    sizes.set(dataset.name, {
      used,
      referenced,
      logicalUsed: Math.round(
        (referenced + usedBySnapshots) * dataset.compressRatio +
          children.reduce((sum, child) => sum + child.logicalUsed, 0),
      ),
      logicalReferenced: Math.round(referenced * dataset.compressRatio),
      usedBySnapshots,
      usedByChildren,
      written: Math.round(written),
    });
  }
  return sizes;
}

function availableBytes(
  world: DemoWorld,
  host: HostModel,
  pool: PoolModel,
  t: Date,
) {
  const { space } = poolTopology(world, host, pool, t);
  const deflate = space.total > 0 ? space.deflated / space.total : 1;
  const usable = space.deflated * (1 - SLOP_FRACTION);
  return Math.max(0, Math.round(usable - space.alloc * deflate));
}

const ratio = (value: number) => value.toFixed(2);

function datasetEntry(
  dataset: DatasetModel,
  sizes: DatasetSizes,
  available: number,
  inherited: {
    mountpoint?: Inheritable;
    compression: Inheritable;
    recordsize?: Inheritable;
  },
  pool: PoolModel,
) {
  const isVolume = dataset.type === "volume";
  const quotaSource = dataset.quota > 0 ? LOCAL_SOURCE : DEFAULT_SOURCE;
  const usedByDataset = sizes.referenced;
  return {
    name: dataset.name,
    type: isVolume ? "VOLUME" : "FILESYSTEM",
    pool: pool.name,
    createtxg: txgAt(pool, dataset.createdAt),
    properties: {
      type: property(dataset.type),
      used: property(sizes.used),
      referenced: property(sizes.referenced),
      available: property(
        dataset.quota > 0
          ? Math.max(0, Math.min(available, dataset.quota - sizes.used))
          : available,
      ),
      logicalused: property(sizes.logicalUsed),
      logicalreferenced: property(sizes.logicalReferenced),
      compressratio: property(
        ratio(sizes.used > 0 ? Math.max(1, sizes.logicalUsed / sizes.used) : 1),
      ),
      refcompressratio: property(ratio(dataset.compressRatio)),
      written: property(sizes.written),
      usedbysnapshots: property(sizes.usedBySnapshots),
      usedbydataset: property(usedByDataset),
      usedbychildren: property(sizes.usedByChildren),
      quota: property(dataset.quota, quotaSource),
      refquota: property(0, DEFAULT_SOURCE),
      reservation: property(0, DEFAULT_SOURCE),
      mountpoint: inherited.mountpoint
        ? property(inherited.mountpoint.value, inherited.mountpoint.source)
        : property("-", NO_SOURCE),
      creation: property(epochSeconds(dataset.createdAt)),
      recordsize: inherited.recordsize
        ? property(inherited.recordsize.value, inherited.recordsize.source)
        : property("-", NO_SOURCE),
      compression: property(
        inherited.compression.value,
        inherited.compression.source,
      ),
      encryption: property(dataset.encryption, DEFAULT_SOURCE),
      keystatus: property("none", NO_SOURCE),
      encryptionroot: property("-", NO_SOURCE),
    },
  };
}

const RECORDSIZE_DEFAULT = 128 * 1024;

export function renderZfsList(
  world: DemoWorld,
  host: HostModel,
  t: Date,
  snapshots: SnapshotAt[] = snapshotsAt(world, host, t),
): string {
  const datasets = presentDatasets(world, host, t).sort((a, b) =>
    a.name < b.name ? -1 : 1,
  );
  const sizes = datasetSizes(world, datasets, snapshots, t);
  const pools = new Map(
    hostPoolsAt(world, host, t).map((pool) => [pool.name, pool]),
  );
  const available = new Map(
    [...pools].map(([name, pool]) => [
      name,
      availableBytes(world, host, pool, t),
    ]),
  );
  const resolved = new Map<
    string,
    {
      mountpoint?: Inheritable;
      compression: Inheritable;
      recordsize?: Inheritable;
    }
  >();
  const entries = datasets.map((dataset) => {
    const parentName = parentOf(dataset.name);
    const parent = parentName ? resolved.get(parentName) : undefined;
    const poolName = dataset.name.split("/")[0] ?? dataset.name;
    const pool = pools.get(poolName) as PoolModel;
    const isVolume = dataset.type === "volume";
    const mountpoint =
      isVolume || dataset.mountpoint === null
        ? undefined
        : inherit(
            dataset.mountpoint,
            parent?.mountpoint,
            parentName,
            parent?.mountpoint
              ? childMountpoint(String(parent.mountpoint.value), dataset.name)
              : undefined,
            `/${dataset.name}`,
          );
    const recordsize = isVolume
      ? undefined
      : inherit(
          dataset.recordsize ?? RECORDSIZE_DEFAULT,
          parent?.recordsize,
          parentName,
          parent?.recordsize?.value,
          RECORDSIZE_DEFAULT,
        );
    const compression = inherit(
      dataset.compression,
      parent?.compression,
      parentName,
      parent?.compression.value,
      "on",
    );
    const inherited = { mountpoint, compression, recordsize };
    resolved.set(dataset.name, inherited);
    return datasetEntry(
      dataset,
      sizes.get(dataset.name) as DatasetSizes,
      available.get(poolName) ?? 0,
      inherited,
      pool,
    );
  });
  return jsonWithBigInts({
    output_version: { command: "zfs list", vers_major: 0, vers_minor: 1 },
    datasets: Object.fromEntries(entries.map((entry) => [entry.name, entry])),
  });
}

// zfs list -j --json-int -p -t snapshot -o name,guid,used,referenced,written,creation -s creation

export function renderZfsSnapshots(
  world: DemoWorld,
  host: HostModel,
  t: Date,
  snapshots: SnapshotAt[] = snapshotsAt(world, host, t),
): string {
  const pools = new Map(
    hostPoolsAt(world, host, t).map((pool) => [pool.name, pool]),
  );
  const entries = snapshots.map((snapshot) => {
    const poolName = snapshot.dataset.split("/")[0] ?? snapshot.dataset;
    const pool = pools.get(poolName) as PoolModel;
    const fullName = `${snapshot.dataset}@${snapshot.name}`;
    return [
      fullName,
      {
        name: fullName,
        type: "SNAPSHOT",
        pool: poolName,
        createtxg: txgAt(pool, snapshot.creation),
        dataset: snapshot.dataset,
        snapshot_name: snapshot.name,
        properties: {
          guid: property(bigInt(snapshot.guid)),
          used: property(snapshot.used),
          referenced: property(snapshot.referenced),
          written: property(snapshot.written),
          creation: property(epochSeconds(snapshot.creation)),
        },
      },
    ] as const;
  });
  return jsonWithBigInts({
    output_version: { command: "zfs list", vers_major: 0, vers_minor: 1 },
    datasets: Object.fromEntries(entries),
  });
}

// Snapshot activity for zpool history.

export interface SnapshotActivity {
  at: Date;
  dataset: string;
  action: "snapshot" | "destroy" | "receive";
  snapshot?: string;
}

/** Snapshots taken and pruned, and replica receives, in (from, to], for datasets of `pool`. */
export function snapshotActivity(
  world: DemoWorld,
  host: HostModel,
  pool: PoolModel,
  from: Date,
  to: Date,
): SnapshotActivity[] {
  const activity: SnapshotActivity[] = [];
  const datasets = presentDatasets(world, host, to).filter(
    (dataset) => (dataset.name.split("/")[0] ?? "") === pool.name,
  );
  for (const dataset of datasets) {
    const policy = dataset.snapshots;
    if (!policy) continue;
    if (dataset.replicaOf) {
      activity.push(...replicaActivity(world, dataset, from, to));
      continue;
    }
    for (const kind of KINDS) {
      if (policy[kind] === 0) continue;
      let at = latestInstant(policy.style, kind, to);
      while (ms(at) > ms(from) && ms(at) >= ms(dataset.createdAt)) {
        const name = snapshotName(policy.style, kind, at);
        const creation = creationOf(dataset.name, name, kind, at);
        activity.push({
          at: creation,
          dataset: dataset.name,
          action: "snapshot",
          snapshot: name,
        });
        let expired = at;
        for (let step = 0; step < policy[kind]; step++) {
          expired = previousInstant(kind, expired);
        }
        if (ms(expired) >= ms(dataset.createdAt)) {
          activity.push({
            at: addMs(creation, 2000),
            dataset: dataset.name,
            action: "destroy",
            snapshot: snapshotName(policy.style, kind, expired),
          });
        }
        at = previousInstant(kind, at);
      }
    }
  }
  return activity
    .filter((entry) => ms(entry.at) > ms(from) && ms(entry.at) <= ms(to))
    .sort((a, b) => ms(a.at) - ms(b.at));
}

function replicaActivity(
  world: DemoWorld,
  replica: DatasetModel,
  from: Date,
  to: Date,
): SnapshotActivity[] {
  const source = sourceOf(world, replica);
  const sourcePolicy = source.snapshots;
  const policy = replica.snapshots;
  if (!sourcePolicy || !policy) return [];
  const activity: SnapshotActivity[] = [];
  let syncedAt = lastReplicaSync(replica, to);
  while (ms(syncedAt) > ms(from) && ms(syncedAt) >= ms(replica.createdAt)) {
    const receivedAt = addMs(
      syncedAt,
      forkRng(`receive:${replica.name}:${ms(syncedAt)}`).int(20, 240) * 1000,
    );
    activity.push({
      at: receivedAt,
      dataset: replica.name,
      action: "receive",
      snapshot: replicaSnapshotsAt(source, replica, syncedAt).at(-1)?.name,
    });
    const previousSync = addMs(syncedAt, -DAY_MS);
    for (const kind of KINDS) {
      if (sourcePolicy[kind] === 0 || policy[kind] === 0) continue;
      let at = latestInstant(sourcePolicy.style, kind, syncedAt);
      while (ms(at) > ms(previousSync)) {
        let expired = at;
        for (let step = 0; step < policy[kind]; step++) {
          expired = previousInstant(kind, expired);
        }
        if (ms(expired) >= ms(source.createdAt)) {
          activity.push({
            at: addMs(receivedAt, MINUTE_MS),
            dataset: replica.name,
            action: "destroy",
            snapshot: snapshotName(sourcePolicy.style, kind, expired),
          });
        }
        at = previousInstant(kind, at);
      }
    }
    syncedAt = addMs(syncedAt, -DAY_MS);
  }
  return activity;
}
