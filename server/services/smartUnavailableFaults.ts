import { and, eq, inArray, isNotNull, isNull, notExists } from "drizzle-orm";
import { isDisposed, isHistoryState } from "#shared/disk";
import { db } from "~~/server/database/client";
import { disk, smartAttribute, smartReading } from "~~/server/database/schema";
import { parse as parseSmartctlXall } from "~~/server/ingest/smartctl-xall";
import type { DiskSummary } from "~~/server/services/disks";
import type { Detection } from "~~/server/services/faults";

export type SmartUnavailableReason = "unsupported" | "disabled" | "unreadable";

interface Candidate {
  diskId: number;
  body: string;
  exitStatus: number | null;
}

/**
 * Disks whose latest reading has neither a health verdict nor attributes; only
 * these can lack usable SMART data, so only their stored JSON is parsed.
 */
function candidatesAmong(diskIds: number[]): Candidate[] {
  if (diskIds.length === 0) return [];
  return db
    .select({
      diskId: disk.id,
      body: disk.latestRaw,
      exitStatus: smartReading.exitStatus,
    })
    .from(disk)
    .innerJoin(
      smartReading,
      and(
        eq(smartReading.diskId, disk.id),
        eq(smartReading.takenAt, disk.latestReadingAt),
      ),
    )
    .where(
      and(
        inArray(disk.id, diskIds),
        isNotNull(disk.latestRaw),
        isNull(smartReading.smartPassed),
        notExists(
          db
            .select({ id: smartAttribute.id })
            .from(smartAttribute)
            .where(eq(smartAttribute.readingId, smartReading.id)),
        ),
      ),
    )
    .all()
    .filter((row): row is Candidate => row.body !== null);
}

function reportsSmartSupport(body: string) {
  try {
    const json = JSON.parse(body) as Record<string, unknown>;
    return json.smart_support !== undefined;
  } catch {
    return false;
  }
}

export function smartUnavailableReason({
  body,
  exitStatus,
}: Omit<Candidate, "diskId">): SmartUnavailableReason | null {
  let parsed: ReturnType<typeof parseSmartctlXall>["data"];
  try {
    parsed = parseSmartctlXall(body, {
      ...(exitStatus === null ? {} : { exitStatus }),
    }).data;
  } catch {
    return null;
  }
  if (parsed.standby) return null;
  if (reportsSmartSupport(body)) {
    if (!parsed.smartSupport.available) return "unsupported";
    if (!parsed.smartSupport.enabled) return "disabled";
  }
  const usable = Boolean(
    parsed.ata || parsed.nvme || parsed.scsi || parsed.smartStatus,
  );
  if (!usable && parsed.smartctl.exitStatus.commandFailed) return "unreadable";
  return null;
}

export function detectSmartUnavailable({
  disks,
}: {
  disks: DiskSummary[];
}): Detection[] {
  const inService = disks
    .filter((row) => !isHistoryState(row.state) && !isDisposed(row))
    .map((row) => row.id);
  const seen = new Set<number>();
  return candidatesAmong(inService).flatMap((candidate): Detection[] => {
    if (seen.has(candidate.diskId)) return [];
    seen.add(candidate.diskId);
    const reason = smartUnavailableReason(candidate);
    if (!reason) return [];
    return [
      {
        kind: "smart-unavailable",
        key: String(candidate.diskId),
        subjectId: candidate.diskId,
        severity: "warning",
        data: { reason },
        reopen: (previous) => previous.reason !== reason,
      },
    ];
  });
}
