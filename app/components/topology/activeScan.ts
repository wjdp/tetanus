import { formatDuration } from "#shared/hostFreshness";
import { isScanActive, type PoolScan, scanProgress } from "../pool/scan";

export interface ActiveScan {
  percent: number;
  text: string;
}

export function activeScan(
  scan: PoolScan | null,
  now: number,
): ActiveScan | null {
  if (!scan || !isScanActive(scan)) return null;
  const progress = scanProgress(scan, now);
  const left =
    progress.msLeft === null
      ? ""
      : ` · ${formatDuration(progress.msLeft)} left`;
  return {
    percent: progress.percent,
    text: `${progress.verb} ${progress.percent} %${left}`,
  };
}
