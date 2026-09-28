export interface HistoryPoint {
  at: string | Date;
  value: number;
}

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const MONTH_MS = 30.44 * DAY_MS;
const YEAR_MS = 365.25 * DAY_MS;

export const REFERENCE_AGES_DAYS = [7, 30] as const;

const timeOf = (at: string | Date) =>
  typeof at === "string" ? Date.parse(at) : at.getTime();

const plural = (count: number, unit: string) =>
  `${count} ${unit}${count === 1 ? "" : "s"}`;

export function formatSpan(ms: number): string {
  if (ms < DAY_MS) return plural(Math.max(1, Math.round(ms / HOUR_MS)), "hour");
  if (ms < 60 * DAY_MS) return plural(Math.round(ms / DAY_MS), "day");
  if (ms < 2 * YEAR_MS) return plural(Math.round(ms / MONTH_MS), "month");
  return `${(ms / YEAR_MS).toFixed(1)} years`;
}

export function referenceValue(
  points: HistoryPoint[],
  ageDays: number,
  now: number,
): number | null {
  const target = now - ageDays * DAY_MS;
  const [earliest] = points;
  if (!earliest || timeOf(earliest.at) > target) return null;
  let nearest = earliest;
  for (const point of points) {
    if (
      Math.abs(timeOf(point.at) - target) <
      Math.abs(timeOf(nearest.at) - target)
    ) {
      nearest = point;
    }
  }
  return nearest.value;
}

export function unchangedSince(
  points: HistoryPoint[],
  current: number,
): number | null {
  let since: number | null = null;
  for (let index = points.length - 1; index >= 0; index -= 1) {
    const point = points[index];
    if (!point || point.value !== current) break;
    since = timeOf(point.at);
  }
  return since;
}

export function acceptanceSummary(
  points: HistoryPoint[],
  current: number,
  trend: string,
  now: number,
  unit?: string,
): string {
  const value = unit ? `${current} ${unit}` : `${current}`;
  const since = unchangedSince(points, current);
  if (since === null) return `${value}, ${trend}`;
  return `${value} for ${formatSpan(Math.max(0, now - since))}, ${trend}`;
}
