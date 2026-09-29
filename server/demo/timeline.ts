/**
 * Every story instant is a fixed offset from an anchor: the most recent daily reset
 * (04:15 UTC). The replay (`seed(now)`) and every tick of that day share the anchor
 * `resetAnchor(now)`, so a replay from install date to now shows every story, the
 * stories read "a week ago", "last month" on any day the demo runs, and each reset
 * produces the same world shifted by whole days. Fleet dates before 2026 are absolute.
 * `DEMO_EPOCH` is the anchor the spec was written against, used by tests.
 */

export const RESET_UTC = { hour: 4, minute: 15 } as const;

export const DEMO_EPOCH = new Date("2026-09-29T04:15:00Z");

const MINUTE_MS = 60_000;
export const HOUR_MS = 60 * MINUTE_MS;
export const DAY_MS = 24 * HOUR_MS;

export function resetAnchor(now: Date): Date {
  const anchor = new Date(now);
  anchor.setUTCHours(RESET_UTC.hour, RESET_UTC.minute, 0, 0);
  if (anchor > now) anchor.setTime(anchor.getTime() - DAY_MS);
  return anchor;
}

export function addMs(date: Date, ms: number): Date {
  return new Date(date.getTime() + ms);
}

/** `dayOffset` whole days from the anchor's UTC day, at `clock` (HH:MM) UTC. */
function onDay(anchor: Date, dayOffset: number, clock: string): Date {
  const [hours, minutes] = clock.split(":").map(Number);
  const day = new Date(anchor);
  day.setUTCHours(hours ?? 0, minutes ?? 0, 0, 0);
  return addMs(day, dayOffset * DAY_MS);
}

function previousSunday(anchor: Date, clock: string): Date {
  const daysBack = anchor.getUTCDay() === 0 ? 7 : anchor.getUTCDay();
  return onDay(anchor, -daysBack, clock);
}

export const TANK_SCRUB_DURATION_MS = 20.5 * HOUR_MS;
export const TANK_SCRUB_FRACTION_AT_ANCHOR = 0.4;
export const VAULT_SCRUB_DURATION_MS = 9 * HOUR_MS + 40 * MINUTE_MS;
export const VAULT_RESILVER_DURATION_MS = 10 * HOUR_MS + 50 * MINUTE_MS;

export interface Timeline {
  anchor: Date;
  /** A3: 8 pending sectors from here, stable. */
  a3PendingFrom: Date;
  /** A3: the 8 pending sectors accepted ("six months ago"). */
  a3AcceptedAt: Date;
  /** A7: reallocated sectors 0 before, 24 at the anchor. */
  a7ClimbFrom: Date;
  /** V2: reallocated sectors start climbing. */
  v2DegradingFrom: Date;
  /** V2: smartctl overall health FAILED from here. */
  v2SmartFailedAt: Date;
  /** V2: ZFS faults it (too many errors); vault DEGRADED. */
  v2FaultedAt: Date;
  /** V6: hot-plugged, appears in lsblk/smartctl. */
  v6InsertedAt: Date;
  /** `zpool replace vault V2 V6`: `replacing-1` vdev, resilver starts. */
  v2ReplaceAt: Date;
  /** Resilver done: V2 detached from vault, V6 ONLINE, vault ONLINE. */
  vaultResilverEnd: Date;
  /** V2 physically pulled. */
  v2PulledAt: Date;
  /** V2 overridden `dead`, with the manual diary entry. */
  v2DeclaredDeadAt: Date;
  /** V5 hot spare pulled (a week before the anchor): absent from lsblk/smartctl, UNAVAIL spare in zpool status. */
  v5PulledAt: Date;
  /** Manual `zpool scrub tank` after A7's checksum errors; ~40 % at the anchor. */
  tankScrubStart: Date;
  tankScrubEnd: Date;
  /** Weekly vault scrub, last Sunday 00:24, 0 errors. */
  vaultScrubStart: Date;
  vaultScrubEnd: Date;
  /** One warranty ends next month (A17). */
  a17WarrantyExpiry: Date;
  /** The test bench's last collector run before it was switched off. */
  benchLastRunAt: Date;
}

export function createTimeline(anchor: Date = DEMO_EPOCH): Timeline {
  const v2ReplaceAt = onDay(anchor, -31, "18:20");
  const vaultResilverEnd = addMs(v2ReplaceAt, VAULT_RESILVER_DURATION_MS);
  const tankScrubStart = addMs(
    anchor,
    -TANK_SCRUB_FRACTION_AT_ANCHOR * TANK_SCRUB_DURATION_MS,
  );
  const vaultScrubStart = previousSunday(anchor, "00:24");
  return {
    anchor,
    a3PendingFrom: onDay(anchor, -197, "02:40"),
    a3AcceptedAt: onDay(anchor, -182, "21:10"),
    a7ClimbFrom: addMs(anchor, -30 * DAY_MS),
    v2DegradingFrom: onDay(anchor, -44, "11:00"),
    v2SmartFailedAt: onDay(anchor, -35, "14:40"),
    v2FaultedAt: onDay(anchor, -34, "03:12"),
    v6InsertedAt: onDay(anchor, -31, "18:05"),
    v2ReplaceAt,
    vaultResilverEnd,
    v2PulledAt: onDay(anchor, -30, "09:30"),
    v2DeclaredDeadAt: onDay(anchor, -30, "09:45"),
    v5PulledAt: onDay(anchor, -7, "19:30"),
    tankScrubStart,
    tankScrubEnd: addMs(tankScrubStart, TANK_SCRUB_DURATION_MS),
    vaultScrubStart,
    vaultScrubEnd: addMs(vaultScrubStart, VAULT_SCRUB_DURATION_MS),
    a17WarrantyExpiry: onDay(anchor, 23, "00:00"),
    benchLastRunAt: onDay(anchor, -12, "22:00"),
  };
}

export function isoDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}
