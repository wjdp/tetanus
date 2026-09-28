export interface TimePoint {
  at: string | Date;
  value: number;
}

export interface TimeSeries {
  label: string;
  points: TimePoint[];
}

export type AlignedData = [number[], ...(number | null)[][]];

const epochSeconds = (at: string | Date) =>
  (typeof at === "string" ? Date.parse(at) : at.getTime()) / 1000;

export function alignSeries(series: TimeSeries[]): AlignedData {
  const byTime = series.map(
    (entry) =>
      new Map(
        entry.points.map((point) => [epochSeconds(point.at), point.value]),
      ),
  );
  const times = [...new Set(byTime.flatMap((values) => [...values.keys()]))]
    .filter(Number.isFinite)
    .sort((a, b) => a - b);
  return [
    times,
    ...byTime.map((values) => times.map((time) => values.get(time) ?? null)),
  ];
}
