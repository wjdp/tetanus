import { and, asc, eq, gte, isNotNull } from "drizzle-orm";
import {
  type BayDisk,
  type DiskSlot,
  defaultBayLabel,
  enclosureKey,
  type HostBays,
  type LastSlot,
  locationKeyOf,
  parseEnclosureKey,
  pathOfKey,
} from "#shared/bays";
import { db } from "~~/server/database/client";
import { disk, enclosure, host, payload } from "~~/server/database/schema";
import type { EnclosureResult } from "~~/server/ingest/enclosure";
import { parse as parseUdev, type UdevResult } from "~~/server/ingest/udev";
import { bayName, enclosureModelsOf, labelsOf } from "~~/server/services/bays";
import { addAutoEvent, latestAutoEvent } from "~~/server/services/diary";
import {
  type DiskRow,
  getDiskRow,
  isPresent,
  matchKeys,
} from "~~/server/services/disks";
import { extractKeys } from "~~/server/services/identity";
import { notFound } from "~~/server/utils/serviceError";

/** How long before an `enclosure` post a `udev` post counts as the same collector run. */
const RUN_WINDOW_MS = 15 * 60 * 1000;

export function idPathOf(udev: UdevResult): string | null {
  const { properties } = udev;
  if (properties.ID_PART_ENTRY_NUMBER) return null;
  return properties.ID_PATH_ATA_COMPAT || properties.ID_PATH || null;
}

function postsEnclosures(hostId: number) {
  return (
    db
      .select({ id: payload.id })
      .from(payload)
      .where(and(eq(payload.hostId, hostId), eq(payload.source, "enclosure")))
      .get() !== undefined
  );
}

function movedHostThisRun(diskId: number, receivedAt: Date) {
  const moved = latestAutoEvent("disk", diskId, "moved-host");
  return (
    moved !== undefined &&
    receivedAt.getTime() - moved.at.getTime() <= RUN_WINDOW_MS
  );
}

interface Location {
  lastSlot: LastSlot | null;
  lastIdPath: string | null;
}

/**
 * A key can change without the disk moving: `path:` becomes `enc:` on the first
 * run of a collector that reads enclosures. The port tells the two apart.
 */
function physicallyMoved(
  row: DiskRow,
  previous: string,
  next: string,
  location: Location,
) {
  if (parseEnclosureKey(previous) && parseEnclosureKey(next)) return true;
  const previousPort = row.lastSlot?.idPath ?? pathOfKey(previous);
  const nextPort = location.lastIdPath;
  return (
    previousPort === null || nextPort === null || previousPort !== nextPort
  );
}

function relocate(
  row: DiskRow,
  hostId: number,
  location: Location,
  receivedAt: Date,
) {
  const lastLocationKey = locationKeyOf(location.lastSlot, location.lastIdPath);
  const previous = row.lastLocationKey;
  if (
    previous !== null &&
    lastLocationKey !== null &&
    previous !== lastLocationKey &&
    physicallyMoved(row, previous, lastLocationKey, location) &&
    !movedHostThisRun(row.id, receivedAt)
  ) {
    const from = bayName(hostId, previous);
    const to = bayName(hostId, lastLocationKey);
    addAutoEvent({
      subjectType: "disk",
      subjectId: row.id,
      eventType: "moved-bay",
      title: `moved from ${from} to ${to}`,
      data: { hostId, from: previous, to: lastLocationKey },
      at: receivedAt,
    });
  }
  db.update(disk)
    .set({ ...location, lastLocationKey: lastLocationKey ?? previous })
    .where(eq(disk.id, row.id))
    .run();
}

export function observeUdevLocation(
  row: DiskRow,
  hostId: number,
  udev: UdevResult,
  receivedAt: Date,
) {
  const lastIdPath = idPathOf(udev);
  if (lastIdPath === null || row.lastSeenHostId !== hostId) return;
  if (postsEnclosures(hostId)) {
    db.update(disk).set({ lastIdPath }).where(eq(disk.id, row.id)).run();
    return;
  }
  relocate(row, hostId, { lastSlot: null, lastIdPath }, receivedAt);
}

function enclosureIdOf(found: EnclosureResult["enclosures"][number]) {
  return found.id ?? `scsi-${found.name.replaceAll(":", "-")}`;
}

function replaceEnclosures(
  hostId: number,
  data: EnclosureResult,
  receivedAt: Date,
) {
  db.delete(enclosure).where(eq(enclosure.hostId, hostId)).run();
  for (const found of data.enclosures) {
    db.insert(enclosure)
      .values({
        hostId,
        enclosureId: enclosureIdOf(found),
        name: found.name,
        vendor: found.vendor,
        model: found.model,
        slots: found.slots,
        lastSeenAt: receivedAt,
      })
      .onConflictDoNothing()
      .run();
  }
}

function slotsByDevnum(data: EnclosureResult) {
  const slots = new Map<string, DiskSlot>();
  for (const found of data.enclosures) {
    for (const slot of found.slots) {
      if (slot.devnum === null) continue;
      slots.set(slot.devnum, {
        enclosureId: enclosureIdOf(found),
        slot: slot.slot,
      });
    }
  }
  return slots;
}

function disksInThisRun(hostId: number, receivedAt: Date) {
  const since = new Date(receivedAt.getTime() - RUN_WINDOW_MS);
  const udevPosts = db
    .select({ device: payload.device, body: payload.body })
    .from(payload)
    .where(
      and(
        eq(payload.hostId, hostId),
        eq(payload.source, "udev"),
        gte(payload.receivedAt, since),
      ),
    )
    .all();
  const found: { row: DiskRow; devnum: string }[] = [];
  for (const post of udevPosts) {
    const { data: udev } = parseUdev(post.body, { device: post.device });
    if (idPathOf(udev) === null) continue;
    const match = matchKeys(extractKeys({ source: "udev", udev }));
    if (match === null || "conflict" in match) continue;
    const row = getDiskRow(match.diskId);
    if (row?.lastSeenHostId !== hostId) continue;
    found.push({ row, devnum: post.device.replace(/^b/, "") });
  }
  return found;
}

export function observeEnclosures(
  hostId: number,
  data: EnclosureResult,
  receivedAt: Date,
) {
  replaceEnclosures(hostId, data, receivedAt);
  const slots = slotsByDevnum(data);
  for (const { row, devnum } of disksInThisRun(hostId, receivedAt)) {
    const slot = slots.get(devnum);
    relocate(
      row,
      hostId,
      {
        lastSlot: slot ? { ...slot, idPath: row.lastIdPath } : null,
        lastIdPath: row.lastIdPath,
      },
      receivedAt,
    );
  }
}

type OccupantRow = Pick<
  DiskRow,
  "id" | "alias" | "lastSeenAt" | "lastLocationKey"
>;

function occupantsOf(hostId: number, now: Date) {
  const rows: OccupantRow[] = db
    .select({
      id: disk.id,
      alias: disk.alias,
      lastSeenAt: disk.lastSeenAt,
      lastLocationKey: disk.lastLocationKey,
    })
    .from(disk)
    .where(
      and(eq(disk.lastSeenHostId, hostId), isNotNull(disk.lastLocationKey)),
    )
    .orderBy(asc(disk.id))
    .all();
  const occupants = new Map<string, BayDisk & { seenAt: number }>();
  for (const row of rows) {
    const candidate = {
      id: row.id,
      alias: row.alias,
      present: isPresent(row, now),
      seenAt: row.lastSeenAt?.getTime() ?? 0,
    };
    const key = row.lastLocationKey as string;
    const current = occupants.get(key);
    const better =
      !current ||
      (candidate.present && !current.present) ||
      (candidate.present === current.present &&
        candidate.seenAt > current.seenAt);
    if (better) occupants.set(key, candidate);
  }
  return occupants;
}

const bayDisk = (occupant: (BayDisk & { seenAt: number }) | undefined) =>
  occupant
    ? { id: occupant.id, alias: occupant.alias, present: occupant.present }
    : null;

export function listHostBays(hostId: number, now = new Date()): HostBays {
  if (!db.select({ id: host.id }).from(host).where(eq(host.id, hostId)).get()) {
    throw notFound(`Host ${hostId} not found`);
  }
  const labels = labelsOf(hostId);
  const models = enclosureModelsOf(hostId);
  const occupants = occupantsOf(hostId, now);
  const shown = new Set<string>();

  const enclosures = db
    .select()
    .from(enclosure)
    .where(eq(enclosure.hostId, hostId))
    .orderBy(asc(enclosure.name))
    .all()
    .map((row) => ({
      enclosureId: row.enclosureId,
      name: row.name,
      vendor: row.vendor,
      model: row.model,
      slots: row.slots.map((slot) => {
        const locationKey = enclosureKey({
          enclosureId: row.enclosureId,
          slot: slot.slot,
        });
        shown.add(locationKey);
        return {
          locationKey,
          label: labels.get(locationKey) ?? null,
          defaultLabel: defaultBayLabel(locationKey, models),
          slot: slot.slot,
          element: slot.element,
          status: slot.status,
          fault: slot.fault,
          disk: bayDisk(occupants.get(locationKey)),
        };
      }),
    }));

  const paths = [...occupants.entries()]
    .filter(([locationKey]) => !shown.has(locationKey))
    .map(([locationKey, occupant]) => {
      shown.add(locationKey);
      return {
        locationKey,
        label: labels.get(locationKey) ?? null,
        defaultLabel: defaultBayLabel(locationKey, models),
        disk: bayDisk(occupant) as BayDisk,
      };
    })
    .sort((a, b) =>
      (a.label ?? a.defaultLabel).localeCompare(
        b.label ?? b.defaultLabel,
        "en",
        {
          numeric: true,
        },
      ),
    );

  const orphans = [...labels.entries()]
    .filter(([locationKey]) => !shown.has(locationKey))
    .map(([locationKey, label]) => ({
      locationKey,
      label,
      defaultLabel: defaultBayLabel(locationKey, models),
    }));

  return { enclosures, paths, orphans };
}
