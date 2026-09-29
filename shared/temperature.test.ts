import { describe, expect, it } from "vitest";
import {
  resolveTemperatureThresholds,
  TEMPERATURE_DEFAULTS,
  temperatureColour,
} from "./temperature";

describe("resolveTemperatureThresholds", () => {
  it("uses the media defaults without a host", () => {
    expect(resolveTemperatureThresholds(null, "hdd")).toEqual({
      warning: 45,
      error: 55,
    });
    expect(resolveTemperatureThresholds(null, "ssd")).toEqual({
      warning: 60,
      error: 70,
    });
  });

  it.each(["unknown", null] as const)("treats %s media as HDD", (media) => {
    expect(resolveTemperatureThresholds(null, media)).toEqual(
      TEMPERATURE_DEFAULTS.hdd,
    );
  });

  it("prefers the host override for the disk's media", () => {
    const host = { temperatureThresholds: { hdd: { warning: 50, error: 60 } } };
    expect(resolveTemperatureThresholds(host, "hdd")).toEqual({
      warning: 50,
      error: 60,
    });
    expect(resolveTemperatureThresholds(host, "unknown")).toEqual({
      warning: 50,
      error: 60,
    });
  });

  it("falls back to the default when the host leaves the media unset", () => {
    const host = { temperatureThresholds: { hdd: { warning: 50, error: 60 } } };
    expect(resolveTemperatureThresholds(host, "ssd")).toEqual(
      TEMPERATURE_DEFAULTS.ssd,
    );
    expect(
      resolveTemperatureThresholds({ temperatureThresholds: null }, "hdd"),
    ).toEqual(TEMPERATURE_DEFAULTS.hdd);
  });
});

describe("temperatureColour", () => {
  const thresholds = { warning: 45, error: 55 };

  it.each([
    [null, "neutral"],
    [34, "neutral"],
    [44, "neutral"],
    [45, "warning"],
    [54, "warning"],
    [55, "error"],
    [70, "error"],
  ] as const)("%s °C is %s", (celsius, colour) => {
    expect(temperatureColour(celsius, thresholds)).toBe(colour);
  });
});
