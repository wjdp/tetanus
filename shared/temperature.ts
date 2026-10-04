import type { Media } from "./hardware";

export interface TemperatureThresholds {
  warning: number;
  error: number;
}

export interface HostTemperatureThresholds {
  hdd?: TemperatureThresholds;
  ssd?: TemperatureThresholds;
  sustainedMinutes?: number;
}

export type ThresholdMedia = "hdd" | "ssd";

export const DEFAULT_SUSTAINED_MINUTES = 60;

/** Degrees below a threshold a hot disk must cool to before its fault steps down. */
export const TEMPERATURE_CLEAR_MARGIN = 3;

export const TEMPERATURE_DEFAULTS: Record<
  ThresholdMedia,
  TemperatureThresholds
> = {
  hdd: { warning: 45, error: 55 },
  ssd: { warning: 60, error: 70 },
};

export type TemperatureColour = "neutral" | "warning" | "error";

function thresholdMedia(media: Media | null): ThresholdMedia {
  return media === "ssd" ? "ssd" : "hdd";
}

export function resolveTemperatureThresholds(
  host: { temperatureThresholds: HostTemperatureThresholds | null } | null,
  media: Media | null,
): TemperatureThresholds {
  const key = thresholdMedia(media);
  return host?.temperatureThresholds?.[key] ?? TEMPERATURE_DEFAULTS[key];
}

export function resolveSustainedMinutes(
  host: { temperatureThresholds: HostTemperatureThresholds | null } | null,
): number {
  return (
    host?.temperatureThresholds?.sustainedMinutes ?? DEFAULT_SUSTAINED_MINUTES
  );
}

export function temperatureColour(
  celsius: number | null,
  thresholds: TemperatureThresholds,
): TemperatureColour {
  if (celsius === null) return "neutral";
  if (celsius >= thresholds.error) return "error";
  if (celsius >= thresholds.warning) return "warning";
  return "neutral";
}
