// @vitest-environment nuxt
import { mountSuspended } from "@nuxt/test-utils/runtime";
import { describe, expect, it } from "vitest";
import type { DriveSpec } from "#shared/drive-spec";
import type { HardwareJson } from "#shared/hardware";
import DiskSpecs from "./DiskSpecs.vue";
import type { DiskDetail } from "./types";

const exosSpec: DriveSpec = {
  source: "nasdisks",
  snapshot: "2026-09-04",
  matchedModel: "ST16000NM000J",
  model: "ST16000NM000J",
  brand: "Seagate",
  line: "Exos X18",
  capacityTb: 16,
  rpm: 7200,
  cacheMb: 256,
  interface: "SATA",
  formFactor: "3.5",
  recordingTech: "cmr",
  ercTler: true,
  isHelium: true,
  driveClass: "Enterprise",
  mediaType: "hdd",
  inProduction: true,
  alsoSoldAs: ["ST16000NM002J"],
  nandType: null,
  tbwTb: null,
  dwpd: null,
  hasDram: null,
  hasPlp: null,
  sustainedWriteMbps: null,
  afrPct: 1.2,
  reliabilityDriveCount: 12345,
  reliabilitySource: "Backblaze thru Q2 2026 (merged ST16000NM002J)",
};

const mountSpecs = (
  specs: DriveSpec | null,
  hardware: HardwareJson | null = null,
  model = "ST16000NM000J-2TW103",
) =>
  mountSuspended(DiskSpecs, {
    props: { disk: { model, specs, hardware } as unknown as DiskDetail },
  });

describe("DiskSpecs", () => {
  it("shows the dataset facts and attribution, omitting null rows", async () => {
    const text = (await mountSpecs(exosSpec)).text();

    expect(text).toContain("Seagate Exos X18");
    expect(text).toContain("Enterprise");
    expect(text).toContain("256 MB");
    expect(text).toMatch(/TLER\/ERC\s*Yes/);
    expect(text).toMatch(/Helium\s*Yes/);
    expect(text).toContain("1.2 % · 12,345 drives · Backblaze thru Q2 2026");
    expect(text).not.toContain("(merged");
    expect(text).toContain("ST16000NM002J");
    expect(text).not.toContain("NAND");
    expect(text).not.toContain("TBW");
    expect(text).toContain(
      "Specs: nasdisks.com (CC BY 4.0) · Failure rates: Backblaze Drive Stats · snapshot 2026-09-04",
    );
  });

  it("shows SSD endurance rows", async () => {
    const text = (
      await mountSpecs({
        ...exosSpec,
        mediaType: "ssd",
        nandType: "TLC",
        tbwTb: 2900,
        dwpd: 1.3,
        hasDram: true,
        hasPlp: false,
        sustainedWriteMbps: 520,
        afrPct: null,
      })
    ).text();

    expect(text).toMatch(/NAND\s*TLC/);
    expect(text).toMatch(/TBW\s*2,900 TB/);
    expect(text).toMatch(/DWPD\s*1.3/);
    expect(text).toMatch(/DRAM\s*Yes/);
    expect(text).toMatch(/PLP\s*No/);
    expect(text).toContain("520 MB/s");
    expect(text).not.toContain("AFR");
  });

  it("names a local override in the footer", async () => {
    const page = await mountSpecs({
      ...exosSpec,
      source: "local",
      snapshot: "",
      afrPct: null,
    });

    expect(page.get('[data-testid="specs-footer"]').text()).toBe(
      "Specs: local override",
    );
  });

  it("says there is no match, naming the bare model", async () => {
    const page = await mountSpecs(null, null, "WDC WD80EFAX-68LHPN0");

    expect(page.get('[data-testid="specs-missing"]').text()).toBe(
      "No spec match for WD80EFAX",
    );
    expect(page.find('[data-testid="specs-footer"]').exists()).toBe(false);
  });

  it("notes mismatches without styling them as faults", async () => {
    const page = await mountSpecs(exosSpec, {
      specMismatch: ["rotationRate: observed 7200, dataset 5400"],
    });
    const note = page.get('[data-testid="spec-mismatch"]');

    expect(note.text()).toBe(
      "Observed differs from dataset: rotationRate: observed 7200, dataset 5400",
    );
    expect(note.classes()).toContain("text-dimmed");
    expect(note.classes()).not.toContain("text-error");
  });

  it("has no mismatch note when the dataset agrees", async () => {
    const page = await mountSpecs(exosSpec, { specMismatch: [] });

    expect(page.find('[data-testid="spec-mismatch"]').exists()).toBe(false);
  });
});
