import { eq, isNotNull } from "drizzle-orm";
import {
  ATA_SSD_ATTRIBUTES_VERSION,
  type AtaSsdDisk,
  ataSsdAttributesFrom,
} from "#shared/smart/ataSsdAttributes";
import { db } from "~~/server/database/client";
import { disk } from "~~/server/database/schema";
import { parse as parseSmartctl } from "~~/server/ingest/smartctl-xall";
import {
  ensureSettings,
  setAtaSsdAttributesBackfilled,
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

export function backfillAtaSsdAttributesIfStale(now = new Date()): boolean {
  const storedVersion = ensureSettings().config.ataSsdAttributesVersion ?? 0;
  if (storedVersion >= ATA_SSD_ATTRIBUTES_VERSION) return false;
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
    setAtaSsdAttributesBackfilled(now, ATA_SSD_ATTRIBUTES_VERSION);
    return count;
  });
  console.log(
    `ATA SSD attributes v${ATA_SSD_ATTRIBUTES_VERSION} backfilled for ${filled} disks`,
  );
  return true;
}
