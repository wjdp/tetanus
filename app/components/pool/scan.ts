export interface PoolScan {
  function: string;
  state: string;
  startTime: number;
  endTime?: number;
  examined: number;
  toExamine: number;
  errors: number;
}

export interface ScanProgress {
  verb: string;
  percent: number;
  msLeft: number | null;
}

const INACTIVE_STATES = new Set(["FINISHED", "CANCELED", "NONE"]);

export function isScanActive(scan: PoolScan): boolean {
  return !INACTIVE_STATES.has(scan.state);
}

export function scanVerb(scan: PoolScan): string {
  return scan.function.toLowerCase();
}

export function scanProgress(scan: PoolScan, now: number): ScanProgress {
  const fraction = scan.toExamine > 0 ? scan.examined / scan.toExamine : 0;
  const elapsedMs = now - scan.startTime * 1000;
  const msLeft =
    fraction > 0 && fraction < 1 && elapsedMs > 0
      ? (elapsedMs * (1 - fraction)) / fraction
      : null;
  return {
    verb: scanVerb(scan),
    percent: Math.min(100, Math.floor(fraction * 100)),
    msLeft,
  };
}

export function scanEndedAt(scan: PoolScan): Date | null {
  return scan.endTime ? new Date(scan.endTime * 1000) : null;
}

export function scanStartedAt(scan: PoolScan): Date {
  return new Date(scan.startTime * 1000);
}
