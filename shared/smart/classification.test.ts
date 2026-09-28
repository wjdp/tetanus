import { describe, expect, it } from "vitest";
import { attributeClass, DEFECT_ATTRIBUTES } from "./classification";
import { ATA_METADATA } from "./metadata";

describe("attributeClass", () => {
  it("classes defect attributes by id, as string or number", () => {
    expect(attributeClass(5)).toBe("defect");
    expect(attributeClass("197")).toBe("defect");
  });

  it("classes everything else as context", () => {
    expect(attributeClass(4)).toBe("context");
    expect(attributeClass("199")).toBe("context");
    expect(attributeClass("unknown")).toBe("context");
  });
});

describe("DEFECT_ATTRIBUTES", () => {
  it("matches the critical attributes in the vendored scrutiny metadata", () => {
    const critical = Object.entries(ATA_METADATA)
      .filter(([, metadata]) => metadata.critical)
      .map(([attrId]) => attrId);
    expect([...DEFECT_ATTRIBUTES].sort()).toEqual(critical.sort());
  });
});
