import { describe, expect, it } from "vitest";
import type { DriveSpec } from "#shared/drive-spec";
import {
  interfaceDetail,
  linkSpeedDisplay,
  mediaLabel,
  mediaSummary,
  recordingBadge,
  vendorLabel,
} from "./hardware";

const spec = (overrides: Partial<DriveSpec>) => overrides as DriveSpec;

describe("mediaLabel", () => {
  it("adds the rotation rate to hard disks only", () => {
    expect(mediaLabel("hdd", 7200)).toBe("HDD 7200");
    expect(mediaLabel("hdd", null)).toBe("HDD");
    expect(mediaLabel("ssd", 0)).toBe("SSD");
    expect(mediaLabel("unknown", null)).toBeNull();
    expect(mediaLabel(null, null)).toBeNull();
  });
});

describe("vendorLabel", () => {
  it("shortens Western Digital", () => {
    expect(vendorLabel("western-digital")).toBe("WD");
    expect(vendorLabel(null)).toBeNull();
  });
});

describe("recordingBadge", () => {
  const base = { hardware: null, membership: null };

  it("is blank when unknown", () => {
    expect(recordingBadge({ ...base, recordingTech: "unknown" })).toBeNull();
    expect(recordingBadge({ ...base, recordingTech: null })).toBeNull();
  });

  it("warns about SMR only in a pool", () => {
    expect(recordingBadge({ ...base, recordingTech: "smr" })?.color).toBe(
      "neutral",
    );
    expect(
      recordingBadge({ ...base, recordingTech: "smr", membership: {} })?.color,
    ).toBe("warning");
    expect(
      recordingBadge({ ...base, recordingTech: "cmr", membership: {} })?.color,
    ).toBe("neutral");
  });

  it("outlines inferred values", () => {
    const badge = recordingBadge({
      recordingTech: "smr",
      hardware: { recordingTechInferred: true },
      membership: null,
    });
    expect(badge?.variant).toBe("outline");
    expect(badge?.title).toBeTruthy();
  });
});

describe("linkSpeedDisplay", () => {
  it("flags a link negotiated below its maximum", () => {
    expect(
      linkSpeedDisplay({ linkSpeed: { maxBps: 12e9, currentBps: 6e9 } }),
    ).toEqual({
      text: "6.0 Gb/s",
      belowMax: true,
      title: "negotiated below 12.0 Gb/s max",
    });
    expect(
      linkSpeedDisplay({ linkSpeed: { maxBps: 6e9, currentBps: 6e9 } })
        ?.belowMax,
    ).toBe(false);
    expect(linkSpeedDisplay({})).toBeNull();
  });
});

describe("interfaceDetail", () => {
  it("puts the bus version into the label", () => {
    expect(interfaceDetail("SATA via SAS", { sataVersion: "SATA 3.3" })).toBe(
      "SATA 3.3 via SAS",
    );
    expect(interfaceDetail("NVMe", { nvmeVersion: "1.3" })).toBe("NVMe 1.3");
    expect(interfaceDetail("SAS", { scsiTransport: "SAS (SPL-4)" })).toBe(
      "SAS (SPL-4)",
    );
  });

  it("keeps the label without a matching version", () => {
    expect(interfaceDetail("SATA", null)).toBe("SATA");
    expect(interfaceDetail("USB", { sataVersion: "SATA 3.0" })).toBe("USB");
    expect(interfaceDetail(null, { sataVersion: "SATA 3.0" })).toBeNull();
  });
});

describe("mediaSummary", () => {
  it("describes a hard disk", () => {
    expect(
      mediaSummary({
        media: "hdd",
        rotationRate: 7200,
        recordingTech: "cmr",
        specs: spec({ isHelium: true }),
      }),
    ).toBe("HDD · 7200 rpm · CMR · helium");
  });

  it("omits unknown parts", () => {
    expect(
      mediaSummary({
        media: "hdd",
        rotationRate: null,
        recordingTech: "unknown",
        specs: null,
      }),
    ).toBe("HDD");
  });

  it("describes a solid state disk", () => {
    expect(
      mediaSummary({
        media: "ssd",
        rotationRate: 0,
        recordingTech: null,
        specs: spec({ nandType: "TLC", hasDram: true, hasPlp: true }),
      }),
    ).toBe("SSD · TLC · DRAM · PLP");
  });

  it("is null when the media is unknown", () => {
    expect(
      mediaSummary({
        media: null,
        rotationRate: null,
        recordingTech: null,
        specs: null,
      }),
    ).toBeNull();
  });
});
