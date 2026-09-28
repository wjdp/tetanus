import { and, eq, inArray, isNotNull, max } from "drizzle-orm";
import { db } from "~~/server/database/client";
import { zfsEvent } from "~~/server/database/schema";
import type { ZfsEvent } from "~~/server/ingest/zfsEvent";
import { addAutoEvent } from "~~/server/services/diary";

type NumberedEvent = ZfsEvent & { eid: number };

function isNumbered(event: ZfsEvent): event is NumberedEvent {
  return event.eid !== null;
}

function maxStoredEid(hostId: number): number | null {
  return (
    db
      .select({ value: max(zfsEvent.eid) })
      .from(zfsEvent)
      .where(eq(zfsEvent.hostId, hostId))
      .get()?.value ?? null
  );
}

function storedAtByEid(hostId: number, eids: number[]) {
  const rows = db
    .select({ eid: zfsEvent.eid, at: zfsEvent.at })
    .from(zfsEvent)
    .where(and(eq(zfsEvent.hostId, hostId), inArray(zfsEvent.eid, eids)))
    .all();
  return new Map(rows.map((row) => [row.eid as number, row.at.getTime()]));
}

function eidsReset(
  hostId: number,
  numbered: NumberedEvent[],
  maxBefore: number,
): boolean {
  const storedAt = storedAtByEid(
    hostId,
    numbered.map((event) => event.eid),
  );
  const renumbered = numbered.some((event) => {
    const at = storedAt.get(event.eid);
    return at !== undefined && at !== Date.parse(event.at);
  });
  if (renumbered) return true;
  const newest = Math.max(...numbered.map((event) => event.eid));
  return newest < maxBefore && storedAt.size === 0;
}

function archiveEids(hostId: number) {
  db.update(zfsEvent)
    .set({ eid: null })
    .where(and(eq(zfsEvent.hostId, hostId), isNotNull(zfsEvent.eid)))
    .run();
}

function isDuplicateUnnumbered(hostId: number, event: ZfsEvent) {
  return (
    db
      .select({ id: zfsEvent.id })
      .from(zfsEvent)
      .where(
        and(
          eq(zfsEvent.hostId, hostId),
          eq(zfsEvent.at, new Date(event.at)),
          eq(zfsEvent.class, event.class),
        ),
      )
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
    .onConflictDoNothing({ target: [zfsEvent.hostId, zfsEvent.eid] })
    .run();
}

function checkContinuity(
  hostId: number,
  numbered: NumberedEvent[],
  receivedAt: Date,
) {
  const maxBefore = maxStoredEid(hostId);
  if (maxBefore === null || numbered.length === 0) return;
  if (eidsReset(hostId, numbered, maxBefore)) {
    archiveEids(hostId);
    addAutoEvent({
      subjectType: "host",
      subjectId: hostId,
      eventType: "events-reset",
      title: "ZFS event ids restarted",
      body: "The host's event counter went backwards, usually after a reboot.",
      data: { previousMaxEid: maxBefore },
      at: receivedAt,
    });
    return;
  }
  const unseen = numbered
    .map((event) => event.eid)
    .filter((eid) => eid > maxBefore);
  if (unseen.length === 0) return;
  const firstUnseen = Math.min(...unseen);
  if (firstUnseen > maxBefore + 1) {
    addAutoEvent({
      subjectType: "host",
      subjectId: hostId,
      eventType: "events-gap",
      title: `Missed ZFS events ${maxBefore + 1}–${firstUnseen - 1}`,
      data: { from: maxBefore, to: firstUnseen },
      at: receivedAt,
    });
  }
}

export function observeZfsEvents(
  hostId: number,
  events: ZfsEvent[],
  receivedAt: Date,
) {
  checkContinuity(hostId, events.filter(isNumbered), receivedAt);
  for (const event of events) {
    if (event.eid === null && isDuplicateUnnumbered(hostId, event)) continue;
    insertEvent(hostId, event);
  }
}
