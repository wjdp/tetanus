import {
  byIdNames,
  type Fleet,
  TANK_RESILVER_DURATION_MS,
  W1_REPLACED_AT,
  W2_REPLACED_AT,
} from "./fleet";
import { forkRng } from "./prng";
import {
  addMs,
  DAY_MS,
  HOUR_MS,
  type Timeline,
  VAULT_RESILVER_DURATION_MS,
} from "./timeline";
import type {
  AcceptanceSeed,
  ArchivedPoolSeed,
  DatasetModel,
  DiskModel,
  FaultActionSeed,
  HostModel,
  HostName,
  LeafAt,
  LeafState,
  ManualDiarySeed,
  NotificationSeed,
  OverrideSeed,
  PoolHistoryEvent,
  PoolModel,
  PoolState,
  ScanState,
  SmartCounters,
  VdevModel,
  ZpoolEvent,
} from "./types";

interface ScanWindow {
  pool: PoolModel;
  function: ScanState["function"];
  start: Date;
  end: Date;
  /** Bytes repaired over the whole scan. */
  repairedBytes: number;
}

const ms = (date: Date) => date.getTime();
const within = (t: Date, from: Date, until: Date | null | undefined) =>
  ms(t) >= ms(from) && (until == null || ms(t) < ms(until));
const earlier = (a: Date, b: Date | null) => (b && ms(b) < ms(a) ? b : a);
const byTime = <T extends { at: Date }>(a: T, b: T) => ms(a.at) - ms(b.at);
const MIB = 1024 * 1024;

export type Stories = ReturnType<typeof createStories>;

export function createStories(timeline: Timeline, fleet: Fleet) {
  const disk = (alias: string): DiskModel => {
    const found = fleet.disks.find((candidate) => candidate.alias === alias);
    if (!found) throw new Error(`No demo disk ${alias}`);
    return found;
  };
  const host = (name: HostName): HostModel => {
    const found = fleet.hosts.find((candidate) => candidate.name === name);
    if (!found) throw new Error(`No demo host ${name}`);
    return found;
  };
  const pool = (hostName: HostName, name: string): PoolModel => {
    const found = fleet.pools.find(
      (candidate) => candidate.host === hostName && candidate.name === name,
    );
    if (!found) throw new Error(`No demo pool ${hostName}/${name}`);
    return found;
  };
  const poolOf = (target: DiskModel) =>
    target.membership ? pool(target.host, target.membership.pool) : null;

  const tank = pool("atlas", "tank");
  const vault = pool("styx", "vault");

  function isPresent(target: DiskModel, t: Date): boolean {
    return within(t, target.installedAt, target.removedAt);
  }

  function disksPresent(hostName: HostName, t: Date): DiskModel[] {
    return fleet.disks.filter(
      (candidate) => candidate.host === hostName && isPresent(candidate, t),
    );
  }

  /** Clock stops when the disk is pulled; before install it reads its install baseline. */
  function runningUntil(target: DiskModel, t: Date): number {
    return Math.max(
      0,
      ms(earlier(t, target.removedAt)) - ms(target.installedAt),
    );
  }

  function bootsBetween(hostName: HostName, from: Date, to: Date): Date[] {
    return host(hostName).boots.filter(
      (boot) => ms(boot) > ms(from) && ms(boot) <= ms(to),
    );
  }

  function lastBoot(hostName: HostName, t: Date): Date {
    const boots = host(hostName).boots.filter((boot) => ms(boot) <= ms(t));
    return boots.at(-1) ?? host(hostName).installedAt;
  }

  function powerOnHours(target: DiskModel, t: Date): number {
    return (
      target.powerOnHoursAtInstall +
      Math.floor(runningUntil(target, t) / HOUR_MS)
    );
  }

  function powerCycles(target: DiskModel, t: Date): number {
    if (ms(t) < ms(target.installedAt)) return target.powerCyclesAtInstall;
    const end = earlier(t, target.removedAt);
    return (
      target.powerCyclesAtInstall +
      1 +
      bootsBetween(target.host, target.installedAt, end).length
    );
  }

  /** Every fourth reboot was a power cut. */
  function unsafeShutdowns(target: DiskModel, t: Date): number {
    const end = earlier(t, target.removedAt);
    const cuts = host(target.host).boots.filter(
      (boot, index) =>
        index % 4 === 3 &&
        ms(boot) > ms(target.installedAt) &&
        ms(boot) <= ms(end),
    ).length;
    return Math.floor(target.powerCyclesAtInstall / 5) + cuts;
  }

  // Story 2: A7 reallocations, 0 before the climb, 24 at the anchor, then one per 4 days.
  const A7_REALLOCATED_AT_ANCHOR = 24;
  /** The default SMART policy fails Reallocated_Sector_Ct above 16 (observed-threshold table). */
  const A7_FAILS_AT_REALLOCATED = 17;
  function a7Reallocated(t: Date): number {
    if (ms(t) < ms(timeline.a7ClimbFrom)) return 0;
    if (ms(t) <= ms(timeline.anchor)) {
      const progress =
        (ms(t) - ms(timeline.a7ClimbFrom)) /
        (ms(timeline.anchor) - ms(timeline.a7ClimbFrom));
      return Math.floor(A7_REALLOCATED_AT_ANCHOR * progress ** 1.4);
    }
    return (
      A7_REALLOCATED_AT_ANCHOR +
      Math.floor((ms(t) - ms(timeline.anchor)) / (4 * DAY_MS))
    );
  }

  function v2Reallocated(t: Date): number {
    const at = earlier(t, timeline.v2PulledAt);
    if (ms(at) < ms(timeline.v2DegradingFrom)) return 0;
    if (ms(at) < ms(timeline.v2SmartFailedAt)) {
      const progress =
        (ms(at) - ms(timeline.v2DegradingFrom)) /
        (ms(timeline.v2SmartFailedAt) - ms(timeline.v2DegradingFrom));
      return Math.floor(180 * progress ** 2);
    }
    return (
      2210 + 3 * Math.floor((ms(at) - ms(timeline.v2SmartFailedAt)) / HOUR_MS)
    );
  }

  function reallocatedSectors(target: DiskModel, t: Date): number {
    if (target.alias === "A7") return a7Reallocated(t);
    if (target.alias === "V2") return v2Reallocated(t);
    return 0;
  }

  const v2PendingFrom = new Date(
    (ms(timeline.v2DegradingFrom) + ms(timeline.v2SmartFailedAt)) / 2,
  );

  // Story 1: A3 has 8 pending sectors, stable. A12 has 2, new and acknowledged.
  function pendingSectors(target: DiskModel, t: Date): number {
    if (target.alias === "A3")
      return ms(t) >= ms(timeline.a3PendingFrom) ? 8 : 0;
    if (target.alias === "A12")
      return ms(t) >= ms(timeline.a12PendingFrom) ? 2 : 0;
    if (target.alias === "V2") {
      if (ms(t) >= ms(timeline.v2SmartFailedAt)) return 64;
      return ms(t) >= ms(v2PendingFrom) ? 16 : 0;
    }
    return 0;
  }

  function offlineUncorrectable(target: DiskModel, t: Date): number {
    return target.alias === "V2" && ms(t) >= ms(timeline.v2SmartFailedAt)
      ? 64
      : 0;
  }

  function healthPassed(target: DiskModel, t: Date): boolean {
    return !(target.alias === "V2" && ms(t) >= ms(timeline.v2SmartFailedAt));
  }

  function bytesWritten(target: DiskModel, t: Date): number {
    const priorUse =
      (target.powerOnHoursAtInstall / 24) * target.bytesWrittenPerDay * 0.6;
    return Math.round(
      priorUse + (runningUntil(target, t) / DAY_MS) * target.bytesWrittenPerDay,
    );
  }

  function bytesRead(target: DiskModel, t: Date): number {
    return Math.round(
      bytesWritten(target, t) * (target.rotational ? 3.2 : 1.8),
    );
  }

  // Story 5: P1 at 87 % used (see P1_PERCENTAGE_USED_AT_ANCHOR), rising ~1 % per 18 days.
  function percentageUsed(target: DiskModel, t: Date): number | null {
    if (target.enduranceTbw === null) return null;
    return Math.floor(
      (bytesWritten(target, t) / (target.enduranceTbw * 1e12)) * 100,
    );
  }

  /** Per-host ambient + disk offset + daily sine (peak 16:00 UTC) + seasonal + noise, constant within an hour. */
  function temperature(target: DiskModel, t: Date): number {
    const hourIndex = Math.floor(ms(t) / HOUR_MS);
    const hourOfDay = hourIndex % 24;
    const dayOfYear = (ms(t) - Date.UTC(t.getUTCFullYear(), 0, 1)) / DAY_MS;
    const diurnal = 1.6 * Math.sin((2 * Math.PI * (hourOfDay - 10)) / 24);
    const seasonal = 2.5 * Math.sin((2 * Math.PI * (dayOfYear - 111)) / 365.25);
    const noise = forkRng(`temp:${target.alias}:${hourIndex}`).gaussian(
      0,
      0.45,
    );
    const targetPool = poolOf(target);
    const scanLoad =
      target.rotational && targetPool && isScanning(targetPool, t) ? 3 : 0;
    return Math.round(
      host(target.host).ambientC +
        target.temperatureOffsetC +
        diurnal +
        seasonal +
        noise +
        scanLoad,
    );
  }

  function smartCounters(target: DiskModel, t: Date): SmartCounters {
    return {
      powerOnHours: powerOnHours(target, t),
      powerCycles: powerCycles(target, t),
      temperatureC: temperature(target, t),
      reallocatedSectors: reallocatedSectors(target, t),
      pendingSectors: pendingSectors(target, t),
      offlineUncorrectable: offlineUncorrectable(target, t),
      healthPassed: healthPassed(target, t),
      bytesWritten: bytesWritten(target, t),
      bytesRead: bytesRead(target, t),
      percentageUsed: percentageUsed(target, t),
      mediaErrors: 0,
      unsafeShutdowns: unsafeShutdowns(target, t),
    };
  }

  // ZFS topology.

  const memberFrom = (target: DiskModel) =>
    target.memberFrom ?? target.installedAt;
  const memberUntil = (target: DiskModel) =>
    target.memberUntil === undefined ? target.removedAt : target.memberUntil;

  function vdevOf(target: DiskModel, owner: PoolModel): VdevModel | undefined {
    const membership = target.membership;
    if (!membership) return undefined;
    return owner.vdevs.find(
      (candidate) =>
        candidate.class === membership.vdev.class &&
        candidate.index === membership.vdev.index,
    );
  }

  function membersAt(owner: PoolModel, t: Date): DiskModel[] {
    return fleet.disks.filter(
      (candidate) =>
        candidate.host === owner.host &&
        candidate.membership?.pool === owner.name &&
        within(t, memberFrom(candidate), memberUntil(candidate)),
    );
  }

  const A7_EREPORTS: Date[] = (() => {
    const rng = forkRng("ereports:A7");
    const until = ms(timeline.anchor) + 400 * DAY_MS;
    const instants: Date[] = [];
    let at = ms(timeline.a7ClimbFrom) + 20 * HOUR_MS;
    while (at < until) {
      instants.push(new Date(at - (at % 60_000)));
      at += rng.int(40, 90) * HOUR_MS;
    }
    return instants;
  })();

  const V2_EREPORTS: { at: Date; class: ZpoolEvent["class"] }[] = (() => {
    const rng = forkRng("ereports:V2");
    const span = ms(timeline.v2FaultedAt) - ms(timeline.v2SmartFailedAt);
    return Array.from({ length: 9 }, (_, index) => {
      const at =
        ms(timeline.v2SmartFailedAt) + ((index + rng.next()) / 9) * span;
      return {
        at: new Date(at - (at % 1000)),
        class:
          index % 3 === 0 ? "ereport.fs.zfs.checksum" : "ereport.fs.zfs.io",
      } as const;
    }).filter((event) => ms(event.at) < ms(timeline.v2FaultedAt));
  })();

  function countSince(instants: Date[], from: Date, t: Date) {
    return instants.filter((at) => ms(at) > ms(from) && ms(at) <= ms(t)).length;
  }

  function leafErrors(target: DiskModel, t: Date): LeafAt["errors"] {
    const bootedAt = lastBoot(target.host, t);
    if (target.alias === "A7") {
      return {
        read: 0,
        write: 0,
        checksum: countSince(A7_EREPORTS, bootedAt, t),
      };
    }
    if (target.alias === "V2") {
      if (ms(t) >= ms(timeline.v2FaultedAt)) {
        return { read: 17, write: 0, checksum: 204 };
      }
      const since = V2_EREPORTS.filter(
        (event) => ms(event.at) > ms(bootedAt) && ms(event.at) <= ms(t),
      );
      return {
        read: since.filter((event) => event.class === "ereport.fs.zfs.io")
          .length,
        write: 0,
        checksum: since.filter(
          (event) => event.class === "ereport.fs.zfs.checksum",
        ).length,
      };
    }
    return { read: 0, write: 0, checksum: 0 };
  }

  function leafState(target: DiskModel, t: Date): LeafState {
    if (!isPresent(target, t)) return "UNAVAIL";
    if (target.alias === "V2" && ms(t) >= ms(timeline.v2FaultedAt)) {
      return "FAULTED";
    }
    return "ONLINE";
  }

  /**
   * Leaves of the pool at `t`, in vdev order then position. Two disks in one slot mean a
   * `zpool replace` in progress: both are listed with `replacing: true`, the incoming one
   * (later `memberFrom`) `resilvering`. A pulled spare stays listed as UNAVAIL.
   */
  function leavesAt(owner: PoolModel, t: Date): LeafAt[] {
    const members = membersAt(owner, t);
    const leaves = members.flatMap((target): LeafAt[] => {
      const vdev = vdevOf(target, owner);
      const membership = target.membership;
      if (!vdev || !membership || ms(t) < ms(vdev.addedAt)) return [];
      const slotmates = members.filter(
        (other) =>
          other.membership?.vdev.class === membership.vdev.class &&
          other.membership?.vdev.index === membership.vdev.index &&
          other.membership?.position === membership.position,
      );
      const replacing = slotmates.length > 1;
      const newest = slotmates.reduce((latest, other) =>
        ms(memberFrom(other)) > ms(memberFrom(latest)) ? other : latest,
      );
      const state = leafState(target, t);
      return [
        {
          disk: target,
          vdev,
          position: membership.position,
          state,
          replacing,
          resilvering: replacing && newest === target,
          ...(vdev.class === "spare" && {
            spareStatus: state === "ONLINE" ? "AVAIL" : "UNAVAIL",
          }),
          errors: leafErrors(target, t),
        },
      ];
    });
    const order = (leaf: LeafAt) => owner.vdevs.indexOf(leaf.vdev);
    return leaves.sort(
      (a, b) =>
        order(a) - order(b) ||
        a.position - b.position ||
        ms(memberFrom(a.disk)) - ms(memberFrom(b.disk)),
    );
  }

  function poolState(owner: PoolModel, t: Date): PoolState {
    const degraded = leavesAt(owner, t).some(
      (leaf) => leaf.vdev.class !== "spare" && leaf.state !== "ONLINE",
    );
    return degraded ? "DEGRADED" : "ONLINE";
  }

  /** Raw size as `zpool list` reports it: raidz counts parity, mirrors count one side. */
  function poolSizeBytes(owner: PoolModel, t: Date): number {
    const leaves = leavesAt(owner, t).filter(
      (leaf) => leaf.vdev.class !== "spare",
    );
    return owner.vdevs
      .filter((vdev) => vdev.class !== "spare")
      .reduce((total, vdev) => {
        const slots = leaves.filter((leaf) => leaf.vdev === vdev);
        if (slots.length === 0) return total;
        const smallest = Math.min(
          ...slots.map((leaf) => leaf.disk.capacityBytes),
        );
        const members = vdev.type === "mirror" ? 1 : vdev.width;
        return total + smallest * members;
      }, 0);
  }

  const sizesAtAnchor = new Map<PoolModel, number>();
  const sizeAtAnchorOf = (owner: PoolModel) => {
    const cached = sizesAtAnchor.get(owner);
    if (cached !== undefined) return cached;
    const size = poolSizeBytes(owner, timeline.anchor);
    sizesAtAnchor.set(owner, size);
    return size;
  };

  /** `allocatedFraction` is of the pool's size at the anchor; linear, capped at 90 % of the size at `t`. */
  function allocatedBytes(owner: PoolModel, t: Date): number {
    const { atCreation, atAnchor } = owner.allocatedFraction;
    const span = ms(timeline.anchor) - ms(owner.createdAt);
    const progress = Math.max(0, (ms(t) - ms(owner.createdAt)) / span);
    const fraction = atCreation + (atAnchor - atCreation) * progress;
    const sizeAtAnchor = sizeAtAnchorOf(owner);
    return Math.round(
      Math.min(fraction * sizeAtAnchor, 0.9 * poolSizeBytes(owner, t)),
    );
  }

  // Scans.

  function storyScans(owner: PoolModel): ScanWindow[] {
    if (owner === tank) {
      return [
        {
          pool: owner,
          function: "SCRUB",
          start: timeline.tankScrubStart,
          end: timeline.tankScrubEnd,
          repairedBytes: 1.5 * MIB,
        },
        ...[W1_REPLACED_AT, W2_REPLACED_AT].map(
          (start): ScanWindow => ({
            pool: owner,
            function: "RESILVER",
            start,
            end: addMs(start, TANK_RESILVER_DURATION_MS),
            repairedBytes: 0,
          }),
        ),
      ];
    }
    if (owner === vault) {
      return [
        {
          pool: owner,
          function: "RESILVER",
          start: timeline.v2ReplaceAt,
          end: addMs(timeline.v2ReplaceAt, VAULT_RESILVER_DURATION_MS),
          repairedBytes: 0,
        },
      ];
    }
    return [];
  }

  function scheduledStarts(owner: PoolModel, from: Date, to: Date): Date[] {
    if (owner.scrubSchedule === "none") return [];
    const starts: Date[] = [];
    if (owner.scrubSchedule === "weekly-sunday") {
      const cursor = new Date(from);
      cursor.setUTCHours(0, 24, 0, 0);
      cursor.setUTCDate(cursor.getUTCDate() - cursor.getUTCDay());
      for (; ms(cursor) <= ms(to); cursor.setUTCDate(cursor.getUTCDate() + 7)) {
        if (ms(cursor) >= ms(from)) starts.push(new Date(cursor));
      }
      return starts;
    }
    const month = new Date(
      Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), 1, 0, 24),
    );
    for (; ms(month) <= ms(to); month.setUTCMonth(month.getUTCMonth() + 1)) {
      const firstSunday = 1 + ((7 - month.getUTCDay()) % 7);
      const start = new Date(month);
      start.setUTCDate(firstSunday + 7);
      if (ms(start) >= ms(from) && ms(start) <= ms(to)) starts.push(start);
    }
    return starts;
  }

  const overlaps = (a: ScanWindow, b: ScanWindow) =>
    ms(a.start) < ms(b.end) && ms(b.start) < ms(a.end);

  const SCANS_UNTIL = addMs(timeline.anchor, 400 * DAY_MS);

  const scansByPool = new Map(
    fleet.pools.map((owner) => {
      const stories = storyScans(owner);
      const scheduled = scheduledStarts(
        owner,
        addMs(owner.createdAt, DAY_MS),
        SCANS_UNTIL,
      )
        .map(
          (start): ScanWindow => ({
            pool: owner,
            function: "SCRUB",
            start,
            end: addMs(start, owner.scrubDurationMs),
            repairedBytes: 0,
          }),
        )
        .filter((window) => !stories.some((story) => overlaps(story, window)));
      const windows = [...stories, ...scheduled].sort(
        (a, b) => ms(a.start) - ms(b.start),
      );
      return [owner, windows] as const;
    }),
  );

  /** Scans that started in [from, to], oldest first. Cron scrubs clashing with a story scan or resilver are skipped. */
  function scansBetween(owner: PoolModel, from: Date, to: Date): ScanWindow[] {
    return (scansByPool.get(owner) ?? []).filter(
      (window) => ms(window.start) >= ms(from) && ms(window.start) <= ms(to),
    );
  }

  function isScanning(owner: PoolModel, t: Date): boolean {
    return (scansByPool.get(owner) ?? []).some((window) =>
      within(t, window.start, window.end),
    );
  }

  // Story 4: tank ~40 % through a manual scrub at the anchor; vault scrubbed last Sunday.
  function scanState(owner: PoolModel, t: Date): ScanState | null {
    const lookback = new Date(ms(t) - 40 * DAY_MS);
    const latest = scansBetween(owner, lookback, t).at(-1);
    if (!latest) return null;
    const duration = ms(latest.end) - ms(latest.start);
    const progress = Math.min(1, (ms(t) - ms(latest.start)) / duration);
    const finished = progress >= 1;
    const toExamine = allocatedBytes(owner, latest.start);
    return {
      function: latest.function,
      state: finished ? "FINISHED" : "SCANNING",
      startTime: latest.start,
      endTime: finished ? latest.end : null,
      toExamine,
      examined: Math.round(toExamine * progress),
      processed: Math.round(
        latest.function === "RESILVER"
          ? (toExamine * progress) / Math.max(1, leavesAt(owner, t).length - 1)
          : latest.repairedBytes * progress,
      ),
      errors: 0,
      bytesPerSecond: Math.round(toExamine / (duration / 1000)),
    };
  }

  // zpool events since the host's last boot.

  function zpoolEvents(hostName: HostName, t: Date): ZpoolEvent[] {
    const bootedAt = lastBoot(hostName, t);
    const events: ZpoolEvent[] = [];
    for (const owner of fleet.pools.filter(
      (candidate) => candidate.host === hostName,
    )) {
      for (const scan of scansBetween(owner, bootedAt, t)) {
        const isScrub = scan.function === "SCRUB";
        events.push({
          at: scan.start,
          class: isScrub
            ? "sysevent.fs.zfs.scrub_start"
            : "sysevent.fs.zfs.resilver_start",
          pool: owner.name,
        });
        if (ms(scan.end) <= ms(t)) {
          events.push({
            at: scan.end,
            class: isScrub
              ? "sysevent.fs.zfs.scrub_finish"
              : "sysevent.fs.zfs.resilver_finish",
            pool: owner.name,
          });
        }
      }
    }
    if (hostName === "atlas") {
      for (const at of A7_EREPORTS) {
        events.push({
          at,
          class: "ereport.fs.zfs.checksum",
          pool: "tank",
          vdevAlias: "A7",
        });
      }
    }
    if (hostName === "styx") {
      for (const event of V2_EREPORTS) {
        events.push({ ...event, pool: "vault", vdevAlias: "V2" });
      }
      events.push(
        {
          at: timeline.v2FaultedAt,
          class: "resource.fs.zfs.statechange",
          pool: "vault",
          vdevAlias: "V2",
          vdevState: "FAULTED",
        },
        {
          at: timeline.v2ReplaceAt,
          class: "sysevent.fs.zfs.vdev_attach",
          pool: "vault",
          vdevAlias: "V6",
        },
        {
          at: addMs(timeline.vaultResilverEnd, 2000),
          class: "sysevent.fs.zfs.config_sync",
          pool: "vault",
        },
        {
          at: timeline.v5PulledAt,
          class: "resource.fs.zfs.removed",
          pool: "vault",
          vdevAlias: "V5",
        },
        {
          at: addMs(timeline.v5PulledAt, 1000),
          class: "resource.fs.zfs.statechange",
          pool: "vault",
          vdevAlias: "V5",
          vdevState: "UNAVAIL",
        },
      );
    }
    return events
      .filter((event) => ms(event.at) > ms(bootedAt) && ms(event.at) <= ms(t))
      .sort(byTime);
  }

  // zpool history (commands only; the renderer adds sanoid/zfs-auto-snap snapshot and destroy lines).

  const leafName = (alias: string) => {
    const target = disk(alias);
    return host(target.host).vdevIdConf
      ? alias
      : `/dev/disk/by-id/${byIdNames(target)[0]}-part2`;
  };
  const bootPart = (alias: string) =>
    `/dev/disk/by-id/${byIdNames(disk(alias))[0]}-part2`;
  const wholeDisk = (alias: string) =>
    `/dev/disk/by-id/${byIdNames(disk(alias))[0]}`;
  const ROOT_POOL_OPTIONS =
    "-o ashift=12 -o autotrim=on -O compression=lz4 -O acltype=posixacl -O xattr=sa -O relatime=on -O canmount=off -O mountpoint=/ -R /mnt";

  function staticHistory(): (PoolHistoryEvent & { host: HostName })[] {
    const vdevAddedAt = (owner: PoolModel, index: number) =>
      owner.vdevs.find((vdev) => vdev.index === index)?.addedAt ??
      owner.createdAt;
    const atlasRpool = pool("atlas", "rpool");
    const scratch = pool("atlas", "scratch");
    const styxRpool = pool("styx", "rpool");
    const pipRpool = pool("pip", "rpool");
    const burnin = pool("bench", "burnin");
    const events: (PoolHistoryEvent & { host: HostName })[] = [
      {
        host: "atlas",
        at: atlasRpool.createdAt,
        pool: "rpool",
        command: `zpool create ${ROOT_POOL_OPTIONS} rpool mirror ${bootPart("A15")} ${bootPart("A16")}`,
      },
      {
        host: "atlas",
        at: tank.createdAt,
        pool: "tank",
        command:
          "zpool create -o ashift=12 -O compression=lz4 -O atime=off -O xattr=sa -O acltype=posixacl tank raidz2 A1 A2 A3 A4 W1 W2",
      },
      {
        host: "atlas",
        at: addMs(tank.createdAt, 60_000),
        pool: "tank",
        command: "zpool set autoexpand=on tank",
      },
      {
        host: "atlas",
        at: vdevAddedAt(tank, 1),
        pool: "tank",
        command: "zpool add tank raidz2 A7 A8 A9 A10 A11 A12",
      },
      {
        host: "atlas",
        at: scratch.createdAt,
        pool: "scratch",
        command:
          "zpool create -o ashift=12 -o autotrim=on -O compression=off -O atime=off scratch A17",
      },
      {
        host: "atlas",
        at: vdevAddedAt(tank, 2),
        pool: "tank",
        command: "zpool add tank special mirror A13 A14",
      },
      {
        host: "atlas",
        at: addMs(vdevAddedAt(tank, 2), 5 * 60_000),
        pool: "tank",
        command: "zfs set special_small_blocks=64K tank/photos",
      },
      {
        host: "atlas",
        at: W1_REPLACED_AT,
        pool: "tank",
        command: "zpool replace tank W1 A5",
      },
      {
        host: "atlas",
        at: W2_REPLACED_AT,
        pool: "tank",
        command: "zpool replace tank W2 A6",
      },
      {
        host: "styx",
        at: styxRpool.createdAt,
        pool: "rpool",
        command: `zpool create ${ROOT_POOL_OPTIONS} rpool ${bootPart("V7")}`,
      },
      {
        host: "styx",
        at: vault.createdAt,
        pool: "vault",
        command:
          "zpool create -o ashift=12 -O compression=zstd -O atime=off -O xattr=sa vault raidz1 V1 V2 V3 V4",
      },
      {
        host: "styx",
        at:
          vault.vdevs.find((vdev) => vdev.class === "spare")?.addedAt ??
          vault.createdAt,
        pool: "vault",
        command: "zpool add vault spare V5",
      },
      {
        host: "styx",
        at: timeline.v2ReplaceAt,
        pool: "vault",
        command: "zpool replace vault V2 V6",
      },
      {
        host: "pip",
        at: pipRpool.createdAt,
        pool: "rpool",
        command: `zpool create ${ROOT_POOL_OPTIONS} rpool mirror ${leafName("P1")} ${leafName("P2")}`,
      },
      {
        host: "bench",
        at: burnin.createdAt,
        pool: "burnin",
        command: `zpool create -o ashift=12 burnin mirror ${wholeDisk("B1")} ${wholeDisk("B2")}`,
      },
    ];
    for (const [hostName, datasets] of Object.entries(fleet.datasets) as [
      HostName,
      DatasetModel[],
    ][]) {
      const byName = new Map(
        datasets.map((dataset) => [dataset.name, dataset]),
      );
      for (const dataset of datasets) {
        if (!dataset.name.includes("/") || dataset.replicaOf) continue;
        const parent = byName.get(dataset.name.replace(/\/[^/]+$/, ""));
        const options = [
          dataset.volsize !== null && `-V ${dataset.volsize}`,
          dataset.recordsize !== null &&
            dataset.recordsize !== 128 * 1024 &&
            `-o recordsize=${dataset.recordsize / (1024 * 1024)}M`,
          dataset.compression !== parent?.compression &&
            `-o compression=${dataset.compression}`,
          dataset.mountpoint === "none" && "-o mountpoint=none",
        ].filter(Boolean);
        events.push({
          host: hostName,
          at: addMs(dataset.createdAt, 30_000),
          pool: dataset.name.split("/")[0] ?? dataset.name,
          command: ["zfs create", ...options, dataset.name].join(" "),
        });
      }
    }
    return events;
  }

  const historyByHost = (() => {
    const grouped: Record<HostName, PoolHistoryEvent[]> = {
      atlas: [],
      styx: [],
      pip: [],
      bench: [],
    };
    for (const { host: owner, ...event } of staticHistory()) {
      grouped[owner].push(event);
    }
    return grouped;
  })();

  function poolHistory(hostName: HostName, t: Date): PoolHistoryEvent[] {
    const scrubs = fleet.pools
      .filter((owner) => owner.host === hostName)
      .flatMap((owner) =>
        scansBetween(owner, owner.createdAt, t)
          .filter((scan) => scan.function === "SCRUB")
          .map((scan) => ({
            at: scan.start,
            pool: owner.name,
            command: `zpool scrub ${owner.name}`,
          })),
      );
    return [...historyByHost[hostName], ...scrubs]
      .filter((event) => ms(event.at) <= ms(t))
      .sort(byTime);
  }

  /**
   * Every instant at which ZFS state changes, oldest first, for the replay to ingest the
   * ZFS sources at; includes instants after the anchor (the seed keeps those ≤ now).
   */
  const zfsInstants: Date[] = (() => {
    const instants = [
      ...fleet.pools.map((owner) => owner.createdAt),
      ...fleet.pools.flatMap((owner) =>
        owner.vdevs.map((vdev) => vdev.addedAt),
      ),
      ...fleet.disks.flatMap((target) =>
        [
          target.installedAt,
          target.removedAt,
          target.memberFrom,
          target.memberUntil,
        ].filter((at): at is Date => at instanceof Date),
      ),
      ...fleet.pools.flatMap((owner) =>
        storyScans(owner).flatMap((scan) => [scan.start, scan.end]),
      ),
      timeline.vaultScrubStart,
      timeline.vaultScrubEnd,
      timeline.v2FaultedAt,
      ...V2_EREPORTS.map((event) => event.at),
      ...A7_EREPORTS.filter((at) => ms(at) <= ms(timeline.anchor) + 2 * DAY_MS),
    ];
    return [...new Set(instants.map(ms))]
      .sort((a, b) => a - b)
      .map((at) => new Date(at));
  })();

  return {
    timeline,
    disk,
    host,
    pool,
    isPresent,
    disksPresent,
    lastBoot,
    powerOnHours,
    powerCycles,
    unsafeShutdowns,
    reallocatedSectors,
    pendingSectors,
    offlineUncorrectable,
    healthPassed,
    bytesWritten,
    bytesRead,
    percentageUsed,
    temperature,
    smartCounters,
    leavesAt,
    poolState,
    poolSizeBytes,
    allocatedBytes,
    scansBetween,
    scanState,
    zpoolEvents,
    poolHistory,
    zfsInstants,
    seeds: createSeeds(
      timeline,
      a7ReallocatedReachesAt(A7_FAILS_AT_REALLOCATED),
      a7ChecksumAcknowledgedAt(),
    ),
  };

  /** Half an hour after the last checksum error before the anchor, so the acknowledgement holds at reset. */
  function a7ChecksumAcknowledgedAt(): Date {
    const last = A7_EREPORTS.filter((at) => ms(at) <= ms(timeline.anchor)).at(
      -1,
    );
    if (!last) throw new Error("A7 has no checksum errors before the anchor");
    return addMs(last, 30 * 60_000);
  }

  function a7ReallocatedReachesAt(count: number): Date {
    const span = ms(timeline.anchor) - ms(timeline.a7ClimbFrom);
    const progress = (count / A7_REALLOCATED_AT_ANCHOR) ** (1 / 1.4);
    return new Date(Math.ceil(ms(timeline.a7ClimbFrom) + progress * span));
  }
}

// Story 7 and the seed-time service calls.

export interface Seeds {
  hostNotes: Record<HostName, string>;
  hostDisplayNames: Record<HostName, string>;
  manualDiary: ManualDiarySeed[];
  acceptances: AcceptanceSeed[];
  faultActions: FaultActionSeed[];
  overrides: OverrideSeed[];
  notifications: NotificationSeed[];
  archivedPools: ArchivedPoolSeed[];
}

function createSeeds(
  timeline: Timeline,
  a7FailedAt: Date,
  a7ChecksumAcknowledgedAt: Date,
): Seeds {
  // V2's reallocations cross the policy threshold days before smartctl's own verdict.
  const v2FailedAt = addMs(timeline.v2DegradingFrom, 3 * DAY_MS);
  const days = (count: number, from = timeline.anchor) =>
    addMs(from, count * DAY_MS);
  const hours = (count: number, from: Date) => addMs(from, count * HOUR_MS);
  const disk = (alias: string) => ({ type: "disk", alias }) as const;
  const onHost = (host: HostName) => ({ type: "host", host }) as const;
  const onPool = (host: HostName, pool: string) =>
    ({ type: "pool", host, pool }) as const;

  return {
    hostDisplayNames: {
      atlas: "Atlas",
      styx: "Styx (offsite)",
      pip: "Pip",
      bench: "Test bench",
    },
    hostNotes: {
      atlas: [
        "## Hardware",
        "",
        '- Fractal Define 7 XL, 12 × 3.5" bays on two backplanes',
        "- Supermicro X11SCH-F, Xeon E-2236, 64 GB ECC",
        "- LSI 9300-16i (IT mode) for the tank bays and the special SSDs; Intel boot SSDs on the onboard SATA",
        "",
        "## Bays",
        "",
        "| Bay | 1 | 2 | 3 | 4 | 5 | 6 |",
        "| --- | --- | --- | --- | --- | --- | --- |",
        "| Top | A1 | A2 | A3 | A4 | A5 | A6 |",
        "| Bottom | A7 | A8 | A9 | A10 | A11 | A12 |",
        "",
        "Scrubs: second Sunday of the month (zfsutils cron). sanoid for snapshots, syncoid pulls to styx nightly.",
      ].join("\n"),
      styx: [
        "Offsite backup box at my parents'. HP MicroServer Gen10 Plus, 4 bays + one internal SATA for the spare.",
        "",
        "- Reached over WireGuard (`wg0`), syncoid pulls from atlas at 02:30",
        "- Weekly scrub timer on Sundays (`zfs-scrub-weekly@vault.timer`)",
        "- UPS: APC Back-UPS 700, NUT shuts it down at 20 % battery",
      ].join("\n"),
      pip: [
        "Beelink mini PC in the living room. Home Assistant, Frigate (4 cameras), Jellyfin client cache.",
        "",
        "- `rpool` is a mirror of two different NVMe drives; Frigate writes ~100 GB a day to `rpool/frigate`",
        "- The 870 EVO is LUKS + ext4 at `/srv/media`, unlocked from a keyfile on rpool",
      ].join("\n"),
      bench: [
        "Old desktop under the workbench for burning in secondhand disks. Switched on when there is something to test.",
        "",
        "- `burnin` is a mirror of two used Exos X16 from eBay, kept as a warm copy of `tank/photos`",
      ].join("\n"),
    },
    manualDiary: [
      {
        subject: onHost("atlas"),
        title: "Built atlas",
        body: "Six-wide raidz2 to start: four Exos X16 and the two shucked 12 TB white labels until I can afford two more 16s.",
        at: new Date("2019-11-16T18:00:00Z"),
      },
      {
        subject: disk("W1"),
        title: "Shucked from a WD Elements 12 TB",
        body: "Taped pin 3 so it spins up on the backplane. Warranty gone with the enclosure.",
        at: new Date("2019-10-27T15:20:00Z"),
      },
      {
        subject: onPool("atlas", "tank"),
        title: "Second raidz2 vdev",
        body: "Four Exos X18 and two HC550. 18 TB drives in a mixed vdev; ZFS uses the smallest, which is all 18s here.",
        at: new Date("2021-04-10T12:00:00Z"),
      },
      {
        subject: onPool("atlas", "tank"),
        title: "Added a special vdev",
        body: "Two 870 EVO 2 TB, mirrored. `special_small_blocks=64K` on `tank/photos` so thumbnails live on flash.",
        at: new Date("2022-08-20T11:30:00Z"),
      },
      {
        subject: onHost("atlas"),
        title: "Swapped the shucked 12s for HC550s",
        body: "Refurbished HC550 18 TB from Bargain Hardware. One resilver per weekend; vdev 0 grew to 16 TB per disk after the second.",
        at: new Date("2024-03-17T16:00:00Z"),
      },
      {
        subject: disk("W1"),
        title: "Sold",
        body: "Sold on eBay for £120 after a full `badblocks` pass.",
        at: new Date("2024-04-02T18:00:00Z"),
      },
      {
        subject: disk("W2"),
        title: "Kept as a cold spare",
        body: "In the drawer with the anti-static bag. Pin 3 still taped.",
        at: new Date("2024-03-17T12:30:00Z"),
      },
      {
        subject: disk("A3"),
        title: "8 pending sectors after the power cut",
        body: "Showed up the morning after the storm. Long self-test running.",
        at: hours(7, timeline.a3PendingFrom),
      },
      {
        subject: disk("A3"),
        title: "Accepted the pending sectors",
        body: "Long test passed, count stable at 8 for two weeks. Accepted so the dashboard goes quiet unless it moves.",
        at: addMs(timeline.a3AcceptedAt, 60_000),
      },
      {
        subject: disk("A7"),
        title: "Reallocated sectors moving",
        body: "First reallocations plus a couple of checksum errors in `zpool status`. Warranty ended in March, of course.",
        at: days(9, timeline.a7ClimbFrom),
      },
      {
        subject: disk("A7"),
        title: "Replacement ordered",
        body: "Up to the low twenties. Ordered an HC550; pulled V5 out of styx as a stopgap cold spare.",
        at: days(-6),
      },
      {
        subject: onPool("atlas", "tank"),
        title: "Manual scrub",
        body: "Started a scrub to see whether A7's checksum errors come back.",
        at: addMs(timeline.tankScrubStart, 5 * 60_000),
      },
      {
        subject: disk("V2"),
        title: "Faulted overnight",
        body: "ZFS faulted V2 at 03:12 with read and checksum errors. SMART health already FAILED the day before. Vault is running on three disks.",
        at: hours(5, timeline.v2FaultedAt),
      },
      {
        subject: disk("V6"),
        title: "Replacement for V2",
        body: "WD80EFPX from Scan (EFZZ is discontinued). `zpool replace vault V2 V6`.",
        at: addMs(timeline.v2ReplaceAt, 10 * 60_000),
      },
      {
        subject: onPool("styx", "vault"),
        title: "Resilver done",
        body: "10 h 50 m, no errors. Back to ONLINE.",
        at: hours(1, timeline.vaultResilverEnd),
      },
      {
        subject: disk("V2"),
        title: "Dead",
        body: "Pulled from bay 2. Won't spin up on the bench dock. Out of warranty since May 2023; going to the shredder.",
        at: timeline.v2DeclaredDeadAt,
      },
      {
        subject: disk("V5"),
        title: "Pulled the hot spare",
        body: "Taking it to atlas as a cold spare for A7 until the HC550 arrives. Vault has no spare for now.",
        at: addMs(timeline.v5PulledAt, 10 * 60_000),
      },
      {
        subject: disk("P1"),
        title: "Endurance",
        body: "P3 Plus is QLC, 220 TBW. Frigate is chewing through it; plan is to move recordings to the 870 EVO.",
        at: days(-20),
      },
      {
        subject: onHost("pip"),
        title: "Mismatched mirror",
        body: "rpool is a Crucial P3 Plus and a WD Red SN700 on purpose, so they don't wear out together.",
        at: new Date("2022-06-18T21:00:00Z"),
      },
    ],
    acceptances: [
      {
        alias: "A3",
        attrId: "197",
        kind: "accept",
        note: "Long self-test passed; stable at 8 for two weeks.",
        at: timeline.a3AcceptedAt,
      },
      {
        alias: "A7",
        attrId: "5",
        kind: "acknowledge",
        note: "Ordering a replacement.",
        at: addMs(a7FailedAt, 12 * HOUR_MS),
      },
      {
        alias: "A12",
        attrId: "197",
        kind: "acknowledge",
        note: "Long self-test queued; watching it.",
        at: timeline.a12AcknowledgedAt,
      },
    ],
    archivedPools: [
      {
        host: "atlas",
        name: "tfault",
        files: ["/var/tmp/tfault-a.img", "/var/tmp/tfault-b.img"],
        createdAt: days(-9),
        lastSeenAt: hours(2, days(-9)),
        archivedAt: hours(3, days(-9)),
        note: "File-backed test pool for fault fixtures; destroyed.",
      },
    ],
    faultActions: [
      {
        subject: disk("V5"),
        kind: "disk-missing",
        action: "acknowledge",
        note: "Pulled for RMA",
        at: hours(14, timeline.v5PulledAt),
      },
      {
        subject: onPool("atlas", "tank"),
        kind: "leaf-errors",
        action: "acknowledge",
        note: "A7 again. Replacement HC550 ordered; reopens if the count climbs.",
        at: a7ChecksumAcknowledgedAt,
      },
    ],
    overrides: [
      {
        alias: "W1",
        stateOverride: "sold",
        at: new Date("2024-04-02T18:05:00Z"),
        notes: "Sold on eBay, £120.",
      },
      {
        alias: "W2",
        stateOverride: "retired",
        at: new Date("2024-03-17T12:35:00Z"),
        notes: "Cold spare in the drawer.",
      },
      {
        alias: "V2",
        stateOverride: "dead",
        at: timeline.v2DeclaredDeadAt,
        notes: "Failed in vault; replaced by V6.",
      },
    ],
    notifications: [
      {
        rule: "attribute-failed",
        subject: disk("A7"),
        eventType: "attribute-status-changed",
        value: "5",
        detail: "Reallocated Sectors Count failed (17)",
        at: a7FailedAt,
      },
      {
        rule: "disk-failed",
        subject: disk("V2"),
        eventType: "smart-status-changed",
        value: "failed",
        detail: "SMART failed (was passed)",
        at: v2FailedAt,
      },
      {
        rule: "pool-degraded",
        subject: onPool("styx", "vault"),
        eventType: "pool-state-changed",
        value: "DEGRADED",
        detail: "DEGRADED (was ONLINE)",
        at: timeline.v2FaultedAt,
      },
      {
        rule: "pool-recovered",
        subject: onPool("styx", "vault"),
        eventType: "pool-state-changed",
        value: "ONLINE",
        detail: "ONLINE (was DEGRADED)",
        at: timeline.vaultResilverEnd,
      },
      {
        rule: "disk-missing",
        subject: disk("V5"),
        eventType: "state-changed",
        value: "missing",
        detail: "missing (was spare)",
        at: hours(2, timeline.v5PulledAt),
      },
    ],
  };
}
