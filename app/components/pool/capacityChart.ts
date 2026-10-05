import { type ByteSystem, byteUnitFor } from "~/utils/format";

interface CapacityReading {
  at: string;
  allocBytes: number | null;
  usedBytes: number | null;
  availableBytes: number | null;
}

interface ByteSeries {
  label: string;
  points: { at: string; bytes: number }[];
}

function scaled(series: ByteSeries[], system: ByteSystem) {
  const largest = Math.max(
    0,
    ...series.flatMap(({ points }) => points.map(({ bytes }) => bytes)),
  );
  const { unit, divisor } = byteUnitFor(largest, system);
  return {
    unit,
    series: series.map(({ label, points }) => ({
      label,
      points: points.map(({ at, bytes }) => ({
        at,
        value: Number((bytes / divisor).toFixed(2)),
      })),
    })),
  };
}

/** Usable used under its ceiling when `zfs list` has reported, else raw alloc. */
export function capacitySeries(
  readings: CapacityReading[],
  system: ByteSystem,
) {
  const usable = readings.flatMap(({ at, usedBytes, availableBytes }) =>
    usedBytes === null || availableBytes === null
      ? []
      : [{ at, used: usedBytes, total: usedBytes + availableBytes }],
  );
  if (usable.length > 0) {
    return scaled(
      [
        {
          label: "Used",
          points: usable.map(({ at, used }) => ({ at, bytes: used })),
        },
        {
          label: "Used + available",
          points: usable.map(({ at, total }) => ({ at, bytes: total })),
        },
      ],
      system,
    );
  }
  return scaled(
    [
      {
        label: "Allocated, raw",
        points: readings.flatMap(({ at, allocBytes }) =>
          allocBytes === null ? [] : [{ at, bytes: allocBytes }],
        ),
      },
    ],
    system,
  );
}
