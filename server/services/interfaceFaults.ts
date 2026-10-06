import type { DiskSummary } from "~~/server/services/disks";
import type { Detection } from "~~/server/services/faults";

export function detectInterfaceErrors(_context: {
  disks: DiskSummary[];
  now: Date;
}): Detection[] {
  return [];
}
