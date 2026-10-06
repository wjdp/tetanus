import { and, eq, gt, inArray } from "drizzle-orm";
import { isDisposed, isHistoryState } from "#shared/disk";
import { db } from "~~/server/database/client";
import { smartAttribute } from "~~/server/database/schema";
import type { DiskSummary } from "~~/server/services/disks";
import type { Detection } from "~~/server/services/faults";
import { attributeRise } from "~~/server/services/smart";

export const CRC_ERROR_ATTRIBUTE = "199";
export const INTERFACE_ERROR_WINDOW_DAYS = 7;
export const INTERFACE_ERROR_MIN_RISES = 3;

const DAY_MS = 24 * 60 * 60 * 1000;

function disksWithCrcErrorsSince(diskIds: number[], since: Date): Set<number> {
  if (diskIds.length === 0) return new Set();
  const rows = db
    .selectDistinct({ diskId: smartAttribute.diskId })
    .from(smartAttribute)
    .where(
      and(
        inArray(smartAttribute.diskId, diskIds),
        eq(smartAttribute.attrId, CRC_ERROR_ATTRIBUTE),
        gt(smartAttribute.takenAt, since),
        gt(smartAttribute.transformedValue, 0),
      ),
    )
    .all();
  return new Set(rows.map(({ diskId }) => diskId));
}

export function detectInterfaceErrors({
  disks,
  now,
}: {
  disks: DiskSummary[];
  now: Date;
}): Detection[] {
  const inService = disks.filter(
    (row) => !isHistoryState(row.state) && !isDisposed(row),
  );
  const windowStart = new Date(
    now.getTime() - INTERFACE_ERROR_WINDOW_DAYS * DAY_MS,
  );
  const candidates = disksWithCrcErrorsSince(
    inService.map((row) => row.id),
    windowStart,
  );
  return inService.flatMap((row): Detection[] => {
    if (!candidates.has(row.id)) return [];
    const { rise, readings, latest } = attributeRise(
      row.id,
      CRC_ERROR_ATTRIBUTE,
      now,
      INTERFACE_ERROR_WINDOW_DAYS,
    );
    if (readings < INTERFACE_ERROR_MIN_RISES) return [];
    return [
      {
        kind: "interface-errors",
        key: String(row.id),
        subjectId: row.id,
        severity: "warning",
        data: { count: latest, rise, readings },
      },
    ];
  });
}
