import type { Media } from "./hardware";

export interface TemperatureThresholds {
  warning: number;
  error: number;
}

export interface HostTemperatureThresholds {
  hdd?: TemperatureThresholds;
  ssd?: TemperatureThresholds;
}

export type ThresholdMedia = keyof HostTemperatureThresholds;

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

export function temperatureColour(
  celsius: number | null,
  thresholds: TemperatureThresholds,
): TemperatureColour {
  if (celsius === null) return "neutral";
  if (celsius >= thresholds.error) return "error";
  if (celsius >= thresholds.warning) return "warning";
  return "neutral";
}
