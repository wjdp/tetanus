import type { DiskSummary } from "~~/server/services/disks";
import type { Detection } from "~~/server/services/faults";

export function detectSelfTestFailed(_context: {
  disks: DiskSummary[];
}): Detection[] {
  return [];
}
