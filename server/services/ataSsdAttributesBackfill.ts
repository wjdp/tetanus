import { eq, isNotNull } from "drizzle-orm";
import {
  type AtaSsdDisk,
  ataSsdAttributesFrom,
} from "#shared/smart/ataSsdAttributes";
import { db } from "~~/server/database/client";
import { disk } from "~~/server/database/schema";
import { parse as parseSmartctl } from "~~/server/ingest/smartctl-xall";
import {
  ensureSettings,
  setAtaSsdAttributesBackfilledAt,
} from "~~/server/services/settings";

interface BackfillCandidate extends AtaSsdDisk {
  id: number;
  latestRaw: string | null;
}

function backfillDisk({ id, latestRaw, ...hardware }: BackfillCandidate) {
  if (latestRaw === null) return false;
  try {
    const ataSsdAttributes = ataSsdAttributesFrom(
      parseSmartctl(latestRaw, {}).data,
      hardware,
    );
    db.update(disk).set({ ataSsdAttributes }).where(eq(disk.id, id)).run();
    return ataSsdAttributes !== null;
  } catch (error) {
    console.error(`Could not backfill ATA SSD attributes of disk ${id}`, error);
    return false;
  }
}

export function backfillAtaSsdAttributesOnce(now = new Date()): boolean {
  if (ensureSettings().config.ataSsdAttributesBackfilledAt) return false;
  const filled = db.transaction(() => {
    const candidates = db
      .select({
        id: disk.id,
        latestRaw: disk.latestRaw,
        media: disk.media,
        vendor: disk.vendor,
        logicalBlockSize: disk.logicalBlockSize,
      })
      .from(disk)
      .where(isNotNull(disk.latestRaw))
      .all();
    const count = candidates.filter(backfillDisk).length;
    setAtaSsdAttributesBackfilledAt(now);
    return count;
  });
  console.log(`ATA SSD attributes backfilled for ${filled} disks`);
  return true;
}
