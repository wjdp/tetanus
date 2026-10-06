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
    faultCounts: { error: 0, warning: 0, acknowledged: 0 },
    inventory: {},
    ...overrides,
  }) as unknown as DiskDetail;

const mountNameplate = (overrides: Partial<DiskDetail> = {}) =>
  mountSuspended(DiskNameplate, { props: { disk: disk(overrides) } });

const smartStatus = '[data-testid="nameplate-smart-status"]';

describe("DiskNameplate", () => {
  it("links the disk it replaces", async () => {
    const nameplate = await mountSuspended(DiskNameplate, {
      props: { disk: disk({ replacesDiskId: 4 }), replacesLabel: "K1" },
    });

    const replaces = nameplate.get('[data-testid="nameplate-replaces"]');
    expect(replaces.text()).toBe("Replaces K1");
    expect(replaces.get("a").attributes("href")).toBe("/disks/4");
    expect(
      (await mountNameplate())
        .find('[data-testid="nameplate-replaces"]')
        .exists(),
    ).toBe(false);
  });

  it.each([
    ["passed", "success", "filled", "Healthy"],
    ["warning", "warning", "filled", "Warning"],
    ["failed", "error", "filled", "Failing"],
    ["unknown", "neutral", "hollow", "Unknown"],
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

  it("shows the BPID beside the serial once recorded", async () => {
    expect(
      (await mountNameplate()).find('[data-testid="nameplate-bpid"]').exists(),
    ).toBe(false);
    const nameplate = await mountNameplate({
      inventory: { seagateBpid: "1004526218" },
    });
    expect(nameplate.get('[data-testid="nameplate-bpid"]').text()).toBe(
      "· BPID 1004526218",
    );
  });

  it("nudges for a BPID on Seagate disks without one", async () => {
    const nudge = '[data-testid="nameplate-needs-bpid"]';
    expect((await mountNameplate()).find(nudge).exists()).toBe(false);
    expect(
      (await mountNameplate({ vendor: "seagate" })).find(nudge).exists(),
    ).toBe(true);
    expect(
      (
        await mountNameplate({
          vendor: "seagate",
          inventory: { seagateBpid: "1004526218" },
        })
      )
        .find(nudge)
        .exists(),
    ).toBe(false);
  });

  it("notes the 3.3 V pin on white-label drives until it is recorded", async () => {
    const note = '[data-testid="nameplate-pin-note"]';
    const whiteLabel = {
      specs: { line: "White label (Ultrastar He12)" },
    } as Partial<DiskDetail>;
    expect((await mountNameplate()).find(note).exists()).toBe(false);
    expect((await mountNameplate(whiteLabel)).find(note).exists()).toBe(true);
    expect(
      (
        await mountNameplate({
          ...whiteLabel,
          inventory: { pin33Taped: true },
        } as Partial<DiskDetail>)
      )
        .find(note)
        .exists(),
    ).toBe(false);
  });

  it("shows the media glyph beside the model", async () => {
    const nameplate = await mountNameplate();

    const glyph = nameplate.get('[data-media="hdd"]');
    expect(glyph.attributes("width")).toBe("20");
    expect(glyph.classes()).toContain("text-muted");
  });

  it("shows the pool breadcrumb with its state in place of usage, and links the faults", async () => {
    const nameplate = await mountNameplate({
      membership: {
        poolId: 3,
        poolName: "tank",
        poolPath: "/zfs/nas1/tank",
        poolArchived: false,
        vdevName: "/dev/disk/by-vdev/K2-part1",
        groupName: "raidz2-0",
        groupType: "raidz2",
        vdevState: "ONLINE",
      },
      faultCounts: { error: 1, warning: 0, acknowledged: 2 },
    });

    const strip = nameplate.get('[data-testid="status-strip"]');
    expect(strip.find('[data-testid="disk-usage"]').exists()).toBe(false);
    expect(strip.get('[data-testid="pool-breadcrumb"]').text()).toMatch(
      /tank\s*raidz2-0\s*K2-part1\s*ONLINE/,
    );
    const faults = strip.get('[data-testid="disk-fault-badges"]');
    expect(faults.attributes("href")).toBe("/disks/7?tab=faults");
    expect(
      faults.findAll("[data-bucket]").map((badge) => badge.text()),
    ).toEqual(["1", "2"]);
  });

  it("hides the breadcrumb and fault badges when there are none", async () => {
    const strip = (await mountNameplate()).get('[data-testid="status-strip"]');
    expect(strip.find('[data-testid="pool-breadcrumb"]').exists()).toBe(false);
    expect(strip.find('[data-testid="disk-fault-badges"]').exists()).toBe(
      false,
    );
  });

  it("links the SMART status to the SMART tab", async () => {
    const link = (await mountNameplate()).get(smartStatus);
    expect(link.attributes("href")).toContain("tab=smart");
  });

  it("edits the alias in place, dimmed unnamed when blank", async () => {
    const blank = await mountNameplate({ alias: null, purpose: null });
    const alias = blank.get('[data-testid="nameplate-alias"] button');
    expect(alias.text()).toBe("unnamed");
    expect(alias.get("span").classes()).toContain("italic");
    expect(alias.attributes("aria-label")).toBe("Edit Alias");
  });
});
