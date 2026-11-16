import { and, between, eq, isNotNull, lt, max } from "drizzle-orm";
import { db } from "~~/server/database/client";
import { host, zfsEvent } from "~~/server/database/schema";
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

function insertEvent(hostId: number, event: ZfsEvent) {
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

/**
 * A numbered event only matches an unnumbered copy: a copy holding another eid is a
 * different event that happens to look the same.
 */
function storeEvent(hostId: number, event: ZfsEvent) {
  const copies = storedCopies(hostId, event);
  if (event.eid === null) {
    if (copies.length === 0) insertEvent(hostId, event);
    return;
  }
  if (isStoredEid(hostId, event.eid)) return;
  const unnumbered = copies.find((row) => row.eid === null);
  if (!unnumbered) {
    insertEvent(hostId, event);
    return;
  }
  db.update(zfsEvent)
    .set({ eid: event.eid })
    .where(eq(zfsEvent.id, unnumbered.id))
    .run();
}

interface EidSpan {
  oldest: number;
  newest: number;
}

function spanOf(dump: NumberedEvent[]): EidSpan {
  const eids = dump.map((event) => event.eid);
  return { oldest: Math.min(...eids), newest: Math.max(...eids) };
}

function previousSpan(hostId: number) {
  return db
    .select({
      oldest: host.zpoolEventsOldestEid,
      newest: host.zpoolEventsNewestEid,
    })
    .from(host)
    .where(eq(host.id, hostId))
    .get();
}

type PreviousSpan = ReturnType<typeof previousSpan>;

function isRenumbered(hostId: number, dump: NumberedEvent[], span: EidSpan) {
  const stored = db
    .select({ eid: zfsEvent.eid, at: zfsEvent.at })
    .from(zfsEvent)
    .where(
      and(
        eq(zfsEvent.hostId, hostId),
        between(zfsEvent.eid, span.oldest, span.newest),
      ),
    )
    .all();
  const atByEid = new Map(stored.map((row) => [row.eid, row.at.getTime()]));
  return dump.some((event) => {
    const storedAt = atByEid.get(event.eid);
    return storedAt !== undefined && storedAt !== timeOf(event);
  });
}

/**
 * While the ZFS module stays loaded, the kernel buffer only drops events from its
 * front, so neither end of a dump's eid range can move backwards. Hosts without a
 * working RTC stamp boot-time events days in the past, so event times are only
 * compared for equality, never order.
 */
function eidsReset(
  hostId: number,
  dump: NumberedEvent[],
  span: EidSpan,
  previous: PreviousSpan,
) {
  return (
    (previous?.oldest != null && span.oldest < previous.oldest) ||
    (previous?.newest != null && span.newest < previous.newest) ||
    isRenumbered(hostId, dump, span)
  );
}

/** Frees every stored eid for reuse by the new counter. */
function archiveEids(hostId: number) {
  const storedMaxEid =
    db
      .select({ value: max(zfsEvent.eid) })
      .from(zfsEvent)
      .where(eq(zfsEvent.hostId, hostId))
      .get()?.value ?? null;
  db.update(zfsEvent)
    .set({ eid: null })
    .where(and(eq(zfsEvent.hostId, hostId), isNotNull(zfsEvent.eid)))
    .run();
  return storedMaxEid;
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
  if (dump.length === 0) return;
  const span = spanOf(dump);
  const previous = previousSpan(hostId);
  if (eidsReset(hostId, dump, span, previous)) {
    const storedMaxEid = archiveEids(hostId);
    const previousMaxEid = previous?.newest ?? storedMaxEid;
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
  if (previous?.oldest === span.oldest) return;
  const before = maxStoredEidBelow(hostId, span.oldest);
  if (before !== null && span.oldest > before + 1) {
    addAutoEvent({
      subjectType: "host",
      subjectId: hostId,
      eventType: "events-gap",
      title: `Missed ZFS events ${before + 1}–${span.oldest - 1}`,
      data: { from: before, to: span.oldest },
      at: receivedAt,
    });
  }
}

export function observeZpoolEvents(
  hostId: number,
  events: ZfsEvent[],
  receivedAt: Date,
) {
  const numbered = events.filter(isNumbered);
  checkContinuity(hostId, numbered, receivedAt);
  for (const event of events) storeEvent(hostId, event);
  if (numbered.length > 0) recordDumpedSpan(hostId, spanOf(numbered));
}

/**
 * Events at or above the oldest eid are still in the kernel buffer and would be
 * re-sent; the span is also the baseline the next dump's reset check compares with.
 */
function recordDumpedSpan(hostId: number, span: EidSpan) {
  db.update(host)
    .set({
      zpoolEventsOldestEid: span.oldest,
      zpoolEventsNewestEid: span.newest,
    })
    .where(eq(host.id, hostId))
    .run();
}

export function observeZedEvent(hostId: number, event: ZfsEvent) {
  storeEvent(hostId, event);
}
