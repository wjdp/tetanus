import { describe, expect, it } from "vitest";
import type { DriveSpec } from "#shared/drive-spec";
import { specFooter, specRows } from "./specRows";

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

const asMap = (specs: DriveSpec) =>
  Object.fromEntries(specRows(specs).map((row) => [row.label, row.value]));

describe("specRows", () => {
  it("lists the dataset facts in order, omitting nulls and helium", () => {
    expect(specRows(exosSpec)).toEqual([
      { label: "Line", value: "Seagate Exos X18" },
      { label: "Class", value: "Enterprise" },
      { label: "Cache", value: "256 MB" },
      { label: "TLER/ERC", value: "Yes" },
      { label: "AFR", value: "1.2 % · 12,345 drives · Backblaze thru Q2 2026" },
      { label: "In production", value: "Yes" },
      { label: "Also sold as", value: "ST16000NM002J" },
    ]);
  });

  it("lists SSD endurance rows", () => {
    const rows = asMap({
      ...exosSpec,
      mediaType: "ssd",
      nandType: "TLC",
      tbwTb: 2900,
      dwpd: 1.3,
      hasDram: true,
      hasPlp: false,
      sustainedWriteMbps: 520,
      afrPct: null,
    });

    expect(rows).toMatchObject({
      NAND: "TLC",
      TBW: "2,900 TB",
      DWPD: "1.3",
      DRAM: "Yes",
      PLP: "No",
      "Sustained write": "520 MB/s",
    });
    expect(rows).not.toHaveProperty("AFR");
  });

  it("falls back to a generic failure-rate source", () => {
    expect(asMap({ ...exosSpec, reliabilitySource: null }).AFR).toBe(
      "1.2 % · 12,345 drives · Backblaze Drive Stats",
    );
  });
});

describe("specFooter", () => {
  it("credits the dataset and snapshot", () => {
    expect(specFooter(exosSpec)).toBe(
      "Specs: nasdisks.com (CC BY 4.0) · Failure rates: Backblaze Drive Stats · snapshot 2026-09-04",
    );
  });

  it("names a local override", () => {
    expect(specFooter({ ...exosSpec, source: "local", snapshot: "" })).toBe(
      "Specs: local override",
    );
  });
});
