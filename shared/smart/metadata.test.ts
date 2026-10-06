import { describe, expect, it } from "vitest";
import {
  ATA_METADATA,
  attributeMetadata,
  METADATA_SOURCE,
  NVME_METADATA,
  SCSI_METADATA,
} from "./metadata";

describe("vendored scrutiny metadata", () => {
  it("records its source commit", () => {
    expect(METADATA_SOURCE).toMatch(
      /^github\.com\/AnalogJ\/scrutiny@[0-9a-f]{40}$/,
    );
  });

  it("covers the ATA attributes that matter", () => {
    expect(Object.keys(ATA_METADATA).length).toBeGreaterThan(60);
    for (const id of ["5", "187", "188", "194", "197", "198"]) {
      expect(ATA_METADATA[id]).toBeDefined();
    }
  });

  it("carries observed thresholds and display types", () => {
    const reallocated = attributeMetadata("ATA", 5);
    expect(reallocated?.critical).toBe(true);
    expect(reallocated?.displayType).toBe("raw");
    expect(reallocated?.observedThresholds?.length).toBeGreaterThan(0);
    expect(attributeMetadata("ATA", 194)?.transformValueUnit).toBe("°C");
  });

  it("covers NVMe and SCSI keys", () => {
    expect(Object.keys(NVME_METADATA)).toHaveLength(16);
    expect(Object.keys(SCSI_METADATA)).toHaveLength(19);
    expect(attributeMetadata("NVMe", "media_errors")?.ideal).toBe("low");
    expect(attributeMetadata("SCSI", "scsi_grown_defect_list")).toMatchObject({
      ideal: "low",
      critical: true,
    });
  });

  it("returns undefined for unknown attributes", () => {
    expect(attributeMetadata("ATA", 999)).toBeUndefined();
    expect(attributeMetadata("SCSI", "toString")).toBeUndefined();
  });
});
