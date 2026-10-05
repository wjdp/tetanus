// @vitest-environment nuxt
import { mountSuspended, registerEndpoint } from "@nuxt/test-utils/runtime";
import { describe, expect, it } from "vitest";
import DiskSmart from "./DiskSmart.vue";

const at = "2026-09-20T12:00:00.000Z";

function smartOverview(importedUntil: string | null, deviceStatus = "passed") {
  return {
    reading: {
      id: 1,
      takenAt: at,
      devicePath: "/dev/sdb",
      deviceStatus,
      source: "collector",
    },
    attributes: [],
    history: { temperature: [], attributes: {}, importedUntil },
    selfTests: [],
    acceptances: [],
    farm: null,
  };
}

const farm = {
  interface: "ata",
  logVersion: "4.19",
  powerOnHours: 21_000,
  spindleHours: 20_990,
  powerCycles: 40,
  recordingType: "CMR",
  assembledWeek: "2022-W03",
  heliumPressureTripped: false,
  heads: 3,
  workload: { readCommands: 100, randomReads: 25 },
  errors: { reallocatedSectors: 0 },
  environment: { millivolts12: { minimum: 12_003, maximum: 12_087 } },
  perHead: [
    { mrResistance: 400, reallocatedSectors: 0 },
    { mrResistance: 410, reallocatedSectors: 2 },
    { mrResistance: 600, reallocatedSectors: 0 },
  ],
};

registerEndpoint("/api/disks/21/smart", () =>
  smartOverview("2026-09-09T00:00:00.000Z"),
);
registerEndpoint("/api/disks/22/smart", () => smartOverview(null));
registerEndpoint("/api/disks/23/smart", () => smartOverview(null, "unknown"));
registerEndpoint("/api/disks/24/smart", () => smartOverview(null, "failed"));
registerEndpoint("/api/disks/26/smart", () => {
  const overview = smartOverview(null);
  return {
    ...overview,
    reading: { ...overview.reading, powerOnHours: 1_000 },
    farm,
  };
});
registerEndpoint("/api/disks/25/smart", () => ({
  ...smartOverview(null),
  reading: null,
}));

const note = '[data-testid="imported-note"]';

describe("DiskSmart", () => {
  it("notes when readings in range were imported from scrutiny", async () => {
    const component = await mountSuspended(DiskSmart, {
      props: { diskId: 21, protocol: "ata" },
    });

    expect(component.get(note).text()).toBe(
      "Readings before 2026-09-09 were imported from scrutiny at daily resolution",
    );
  });

  it("shows no note for collector-only history", async () => {
    const component = await mountSuspended(DiskSmart, {
      props: { diskId: 22, protocol: "ata" },
    });

    expect(component.text()).toContain("read 2026-09-20");
    expect(component.find(note).exists()).toBe(false);
  });

  it.each([
    [22, "passed", "text-default"],
    [23, "unknown", "text-default"],
    [24, "failed", "text-error"],
  ])(
    "badges disk %i as %s in %s, leaving green to the nameplate",
    async (diskId, status, textClass) => {
      const component = await mountSuspended(DiskSmart, {
        props: { diskId, protocol: "ata" },
      });

      const badge = component.get('[data-testid="smart-status"]');
      expect(badge.text()).toBe(status);
      expect(badge.classes()).toContain(textClass);
      expect(badge.classes()).not.toContain("text-success");
    },
  );

  it("shows the range tabs without a heading, even with no readings", async () => {
    const component = await mountSuspended(DiskSmart, {
      props: { diskId: 25, protocol: "ata" },
    });

    expect(component.text()).toContain("No SMART readings yet.");
    expect(component.find("h2").exists()).toBe(false);
    expect(
      component.findAll('[role="tab"]').map((tab) => tab.text()),
    ).toContain("30d");
  });

  it("shows no FARM section without a FARM log", async () => {
    const component = await mountSuspended(DiskSmart, {
      props: { diskId: 22, protocol: "ata" },
    });
    expect(component.find('[data-testid="farm"]').exists()).toBe(false);
  });

  it("shows FARM facts, flags a reset and highlights odd heads", async () => {
    const component = await mountSuspended(DiskSmart, {
      props: { diskId: 26, protocol: "ata" },
    });
    const section = component.get('[data-testid="farm"]');
    const poweredOn = section.get('[data-fact="Powered on"]');
    expect(poweredOn.text()).toBe(
      "21,000 h · SMART shows 1,000 h: counters reset",
    );
    expect(poweredOn.classes()).toContain("text-warning");
    expect(section.get('[data-fact="Assembled"]').text()).toBe("2022-W03");
    expect(section.get('[data-fact="Read commands"]').text()).toBe(
      "100 · 25 % random",
    );
    expect(section.get('[data-fact="12 V"]').text()).toBe("12.00–12.09 V");

    const rows = section.findAll('[data-testid="farm-heads"] tbody tr');
    expect(rows).toHaveLength(3);
    expect(rows[2]?.find(".text-warning").text()).toBe("600");
    expect(rows[1]?.find(".text-warning").text()).toBe("2");
  });
});
