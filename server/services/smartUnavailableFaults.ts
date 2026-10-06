import type { DiskSummary } from "~~/server/services/disks";
import type { Detection } from "~~/server/services/faults";

export function detectSmartUnavailable(_context: {
  disks: DiskSummary[];
}): Detection[] {
  return [];
}
