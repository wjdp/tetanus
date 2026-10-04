import { and, eq, gte, isNotNull, lt, max } from "drizzle-orm";
import { db } from "~~/server/database/client";
import { zfsEvent } from "~~/server/database/schema";
import type { ZfsEvent } from "~~/server/ingest/zfsEvent";
import { addAutoEvent } from "~~/server/services/diary";

type NumberedEvent = ZfsEvent & { eid: number };

type StoredEvent = typeof zfsEvent.$inferSelect;

function isNumbered(event: ZfsEvent): event is NumberedEvent {
  return event.eid !== null;
}

function timeOf(event: ZfsEvent) {
  return Date.parse(event.at);
}

function isDecimal(value: unknown) {
  return typeof value === "string" && /^\d+$/.test(value);
}

function isHex(value: unknown) {
  return typeof value === "string" && value.startsWith("0x");
}

/**
 * ZED passes some numbers raw where `zpool events -v` decodes them (`7` against
 * `ONLINE`, `1` against `0x1 [READ]`), so values in different notations can't tell
 * two copies of an event apart.
 */
function valuesAgree(stored: unknown, incoming: unknown) {
  return (
    isHex(stored) ||
    isHex(incoming) ||
    isDecimal(stored) !== isDecimal(incoming) ||
    JSON.stringify(stored) === JSON.stringify(incoming)
  );
}

function payloadsAgree(
  stored: Record<string, unknown>,
  incoming: Record<string, unknown>,
) {
  return Object.keys(incoming).every(
    (key) => !(key in stored) || valuesAgree(stored[key], incoming[key]),
  );
}

function storedCopies(hostId: number, event: ZfsEvent): StoredEvent[] {
  return db
    .select()
    .from(zfsEvent)
    .where(
      and(
        eq(zfsEvent.hostId, hostId),
        eq(zfsEvent.at, new Date(event.at)),
        eq(zfsEvent.class, event.class),
      ),
    )
    .all()
    .filter(
      (row) =>
        row.poolGuid === event.poolGuid &&
        row.vdevGuid === event.vdevGuid &&
        payloadsAgree(row.payload, event.fields),
    );
}

function isStoredEid(hostId: number, eid: number) {
  return (
    db
      .select({ id: zfsEvent.id })
      .from(zfsEvent)
      .where(and(eq(zfsEvent.hostId, hostId), eq(zfsEvent.eid, eid)))
      .get() !== undefined
  );
}

function storeEvent(hostId: number, event: ZfsEvent) {
  if (event.eid !== null && isStoredEid(hostId, event.eid)) return;
  const copies = storedCopies(hostId, event);
  if (event.eid !== null) {
    const unnumbered = copies.find((row) => row.eid === null);
    if (unnumbered) {
      db.update(zfsEvent)
        .set({ eid: event.eid })
        .where(eq(zfsEvent.id, unnumbered.id))
        .run();
      return;
    }
  }
  if (copies.length > 0) return;
  db.insert(zfsEvent)
    .values({
      hostId,
      eid: event.eid,
      at: new Date(event.at),
      class: event.class,
      poolGuid: event.poolGuid,
      vdevGuid: event.vdevGuid,
      payload: event.fields,
    })
    .run();
}

/** Concurrent posts can stamp neighbouring events slightly out of eid order. */
const CLOCK_TOLERANCE_MS = 5_000;

/**
 * Eids and event times both rise within one boot, so a stored event with the same eid
 * at a different time, or a higher eid than the dump's newest at a clearly earlier
 * time, predates a reset of the host's event counter.
 */
function eidsReset(hostId: number, dump: NumberedEvent[]) {
  const lowest = Math.min(...dump.map((event) => event.eid));
  const stored = db
    .select({ eid: zfsEvent.eid, at: zfsEvent.at })
    .from(zfsEvent)
    .where(and(eq(zfsEvent.hostId, hostId), gte(zfsEvent.eid, lowest)))
    .all();
  const atByEid = new Map(stored.map((row) => [row.eid, row.at.getTime()]));
  const renumbered = dump.some((event) => {
    const storedAt = atByEid.get(event.eid);
    return storedAt !== undefined && storedAt !== timeOf(event);
  });
  if (renumbered) return true;
  const newest = dump.reduce((a, b) => (b.eid > a.eid ? b : a));
  return stored.some(
    (row) =>
      (row.eid as number) > newest.eid &&
      row.at.getTime() < timeOf(newest) - CLOCK_TOLERANCE_MS,
  );
}

function archiveEidsBefore(hostId: number, before: Date) {
  const previousMaxEid =
    db
      .select({ value: max(zfsEvent.eid) })
      .from(zfsEvent)
      .where(and(eq(zfsEvent.hostId, hostId), lt(zfsEvent.at, before)))
      .get()?.value ?? null;
  db.update(zfsEvent)
    .set({ eid: null })
    .where(
      and(
        eq(zfsEvent.hostId, hostId),
        isNotNull(zfsEvent.eid),
        lt(zfsEvent.at, before),
      ),
    )
    .run();
  return previousMaxEid;
}

function maxStoredEidBelow(hostId: number, eid: number): number | null {
  return (
    db
      .select({ value: max(zfsEvent.eid) })
      .from(zfsEvent)
      .where(and(eq(zfsEvent.hostId, hostId), lt(zfsEvent.eid, eid)))
      .get()?.value ?? null
  );
}

function hasStoredEids(hostId: number) {
  return (
    db
      .select({ id: zfsEvent.id })
      .from(zfsEvent)
      .where(and(eq(zfsEvent.hostId, hostId), isNotNull(zfsEvent.eid)))
      .get() !== undefined
  );
}

/**
 * A `zpool events` dump is the host's whole ring buffer, so it is the only source that
 * can show a counter reset or events the buffer dropped before we saw them. ZED posts
 * arrive concurrently and out of order, so they say nothing about continuity.
 */
function checkContinuity(
  hostId: number,
  dump: NumberedEvent[],
  receivedAt: Date,
) {
  if (dump.length === 0 || !hasStoredEids(hostId)) return;
  if (eidsReset(hostId, dump)) {
    const earliest = new Date(Math.min(...dump.map(timeOf)));
    const previousMaxEid = archiveEidsBefore(hostId, earliest);
    addAutoEvent({
      subjectType: "host",
      subjectId: hostId,
      eventType: "events-reset",
      title: "ZFS event ids restarted",
      body: "The host's event counter went backwards, usually after a reboot.",
      data: { previousMaxEid },
      at: receivedAt,
    });
    return;
  }
  const oldest = Math.min(...dump.map((event) => event.eid));
  const before = maxStoredEidBelow(hostId, oldest);
  if (before !== null && oldest > before + 1) {
    addAutoEvent({
      subjectType: "host",
      subjectId: hostId,
      eventType: "events-gap",
      title: `Missed ZFS events ${before + 1}–${oldest - 1}`,
      data: { from: before, to: oldest },
      at: receivedAt,
    });
  }
}

export function observeZpoolEvents(
  hostId: number,
  events: ZfsEvent[],
  receivedAt: Date,
) {
  checkContinuity(hostId, events.filter(isNumbered), receivedAt);
  for (const event of events) storeEvent(hostId, event);
}

export function observeZedEvent(hostId: number, event: ZfsEvent) {
  storeEvent(hostId, event);
}
