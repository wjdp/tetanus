// @vitest-environment nuxt
import { mountSuspended } from "@nuxt/test-utils/runtime";
import { describe, expect, it } from "vitest";
import type { SeagateFarm } from "#shared/smartctl";
import DiskFarm from "./DiskFarm.vue";

const farm: SeagateFarm = {
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
describe("DiskFarm", () => {
  it("shows FARM facts, flags a reset and highlights odd heads", async () => {
    const section = await mountSuspended(DiskFarm, {
      props: { farm, smartHours: 1_000 },
    });
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
