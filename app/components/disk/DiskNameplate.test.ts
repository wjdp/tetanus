// @vitest-environment nuxt
import { mountSuspended } from "@nuxt/test-utils/runtime";
import { describe, expect, it } from "vitest";
import type { DeviceStatus } from "#shared/smart/status";
import DiskNameplate from "./DiskNameplate.vue";
import type { DiskDetail } from "./types";

const at = "2026-09-01T12:00:00.000Z";

const disk = (overrides: Partial<DiskDetail> = {}) =>
  ({
    id: 7,
    alias: "K2",
    model: "WDC WD80EFAX",
    vendor: "western-digital",
    serial: "VK0ABC",
    firmware: "83.H0A83",
    capacityBytes: 8_001_563_222_016,
    media: "hdd",
    interface: "sata",
    link: null,
    hardware: null,
    logicalBlockSize: 512,
    physicalBlockSize: 4096,
    lastDevicePath: "/dev/sdb",
    firstSeenAt: at,
    lastSeenAt: at,
    hostName: "mars",
    latestStatus: "passed",
    latestTemp: 34,
    latestPowerOnHours: 40_000,
    latestPowerCycles: 120,
    tempThresholds: { warning: 45, error: 55 },
    state: "in-use",
    inferredState: "in-use",
    stateOverride: null,
    usage: { kind: "zfs", fsTypes: [], mounts: [], system: false },
    purpose: null,
    purposeInferred: false,
    membership: null,
    ...overrides,
  }) as unknown as DiskDetail;

const mountNameplate = (overrides: Partial<DiskDetail> = {}) =>
  mountSuspended(DiskNameplate, { props: { disk: disk(overrides) } });

const smartStatus = '[data-testid="nameplate-smart-status"]';
const temperature = '[data-testid="nameplate-temperature"]';

describe("DiskNameplate", () => {
  it.each([
    ["passed", "success", "filled", "SMART passed"],
    ["warning", "warning", "filled", "SMART warning"],
    ["failed", "error", "filled", "SMART failed"],
    ["unknown", "neutral", "hollow", "SMART unknown"],
  ] as const)(
    "shows SMART %s as a %s %s dot with its label",
    async (status, colour, shape, label) => {
      const nameplate = await mountNameplate({
        latestStatus: status satisfies DeviceStatus,
      });

      const badge = nameplate.get(smartStatus);
      expect(badge.text()).toBe(label);
      const dot = badge.get("[data-shape]");
      expect(dot.attributes("data-colour")).toBe(colour);
      expect(dot.attributes("data-shape")).toBe(shape);
    },
  );

  it("shows the media glyph beside the model", async () => {
    const nameplate = await mountNameplate();

    const glyph = nameplate.get('[data-media="hdd"]');
    expect(glyph.attributes("width")).toBe("20");
    expect(glyph.classes()).toContain("text-muted");
  });

  it("leaves a cool temperature in the default colour", async () => {
    const reading = (await mountNameplate()).get(temperature);

    expect(reading.text()).toBe("34 °C");
    expect(reading.classes()).not.toContain("text-warning");
    expect(reading.classes()).not.toContain("text-error");
  });

  it.each([
    [48, "text-warning"],
    [57, "text-error"],
  ])("colours %i °C with %s", async (celsius, textClass) => {
    const reading = (await mountNameplate({ latestTemp: celsius })).get(
      temperature,
    );

    expect(reading.classes()).toContain(textClass);
  });

  it("uses the disk's own thresholds", async () => {
    const reading = (
      await mountNameplate({
        latestTemp: 50,
        tempThresholds: { warning: 60, error: 70 },
      })
    ).get(temperature);

    expect(reading.classes()).not.toContain("text-warning");
  });
});
