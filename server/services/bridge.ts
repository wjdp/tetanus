import { and, between, count, eq, isNull, ne, or } from "drizzle-orm";
import { db } from "~~/server/database/client";
import {
  diaryEntry,
  disk,
  diskKey,
  fault,
  vdev,
} from "~~/server/database/schema";
import { addAutoEvent } from "~~/server/services/diary";
import { type DiskRow, getDiskRow } from "~~/server/services/disks";
import { RUN_WINDOW_MS } from "~~/server/services/locations";

// A USB bridge shows lsblk and udev its own identity, while smartctl -d sat
// sees the drive's. Both sightings share a host and device path within one
// collector run, which is how the bridge-only twin is told apart.
function bridgedTwinsOf(
  row: DiskRow,
  hostId: number,
  devicePath: string,
  receivedAt: Date,
): DiskRow[] {
  const at = receivedAt.getTime();
  return db
    .select()
    .from(disk)
    .where(
      and(
        ne(disk.id, row.id),
        eq(disk.lastSeenHostId, hostId),
        eq(disk.lastDevicePath, devicePath),
        eq(disk.link, "usb"),
        isNull(disk.protocol),
        isNull(disk.latestReadingAt),
        between(
          disk.lastSeenAt,
          new Date(at - RUN_WINDOW_MS),
          new Date(at + RUN_WINDOW_MS),
        ),
        row.capacityBytes === null
          ? undefined
          : or(
              isNull(disk.capacityBytes),
              eq(disk.capacityBytes, row.capacityBytes),
            ),
      ),
    )
    .all()
    .filter(isUntouched);
}

function isUntouched(twin: DiskRow): boolean {
  if (twin.notes !== "" || Object.keys(twin.inventory).length > 0) return false;
  if (twin.stateOverride !== null || twin.disposal !== null) return false;
  if (twin.replacesDiskId !== null) return false;
  const replacedBy = db
    .select({ id: disk.id })
    .from(disk)
    .where(eq(disk.replacesDiskId, twin.id))
    .get();
  const faults = db
    .select({ n: count() })
    .from(fault)
    .where(and(eq(fault.subjectType, "disk"), eq(fault.subjectId, twin.id)))
    .get();
  return replacedBy === undefined && faults?.n === 0;
}

function absorb(row: DiskRow, twin: DiskRow, devicePath: string, at: Date) {
  db.transaction((tx) => {
    tx.update(diskKey)
      .set({ diskId: row.id })
      .where(eq(diskKey.diskId, twin.id))
      .run();
    tx.update(vdev)
      .set({ diskId: row.id })
      .where(eq(vdev.diskId, twin.id))
      .run();
    const twinDiary = and(
      eq(diaryEntry.subjectType, "disk"),
      eq(diaryEntry.subjectId, twin.id),
    );
    tx.delete(diaryEntry)
      .where(and(twinDiary, eq(diaryEntry.eventType, "disk-appeared")))
      .run();
    tx.update(diaryEntry).set({ subjectId: row.id }).where(twinDiary).run();
    tx.delete(disk).where(eq(disk.id, twin.id)).run();
    tx.update(disk)
      .set({
        alias: row.alias ?? twin.alias,
        link: row.link ?? twin.link,
        latestUsage: twin.latestUsage ?? row.latestUsage,
        lastIdPath: row.lastIdPath ?? twin.lastIdPath,
        lastSlot: row.lastSlot ?? twin.lastSlot,
        lastLocationKey: row.lastLocationKey ?? twin.lastLocationKey,
      })
      .where(eq(disk.id, row.id))
      .run();
  });
  addAutoEvent({
    subjectType: "disk",
    subjectId: row.id,
    eventType: "bridge-linked",
    title: `linked its USB bridge identity at ${devicePath}`,
    data: { devicePath },
    at,
  });
}

export function absorbBridgedTwins(
  row: DiskRow,
  hostId: number,
  devicePath: string | null,
  receivedAt: Date,
): DiskRow {
  if (!devicePath) return row;
  const twins = bridgedTwinsOf(row, hostId, devicePath, receivedAt);
  if (twins.length === 0) return row;
  for (const twin of twins) {
    absorb(getDiskRow(row.id) as DiskRow, twin, devicePath, receivedAt);
  }
  return getDiskRow(row.id) as DiskRow;
}
