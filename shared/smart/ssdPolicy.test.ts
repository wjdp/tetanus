import { describe, expect, it } from "vitest";
import type { EvaluatedAttribute } from "./evaluate";
import {
  applySsdPolicy,
  NO_SSD_CONTEXT,
  type SsdPolicyContext,
} from "./ssdPolicy";

const attribute = (
  attrId: string,
  value: number,
  thresh?: number,
): EvaluatedAttribute => ({
  attrId,
  name: attrId,
  value,
  thresh,
  transformedValue: value,
  attributeClass: "defect",
  status: "passed",
});

const statusOf = (a: EvaluatedAttribute, context = NO_SSD_CONTEXT) =>
  applySsdPolicy([a], context)[0]?.status;

const ata = (percentageUsed: number | null = null): SsdPolicyContext => ({
  ataSsdAttributes: { wear: "177", written: null, reserved: ["170"] },
  percentageUsed,
});

describe("applySsdPolicy", () => {
  it("warns on NVMe wear at 80 % and fails at exactly 100 %", () => {
    expect(statusOf(attribute("percentage_used", 79))).toBe("passed");
    expect(statusOf(attribute("percentage_used", 80))).toBe("warning");
    expect(statusOf(attribute("percentage_used", 100))).toBe("failed");
  });

  it("warns on NVMe spare within 10 of the threshold", () => {
    expect(statusOf(attribute("available_spare", 21, 10))).toBe("passed");
    expect(statusOf(attribute("available_spare", 20, 10))).toBe("warning");
  });

  it("decodes NVMe critical warning bits into the reason", () => {
    const [decoded] = applySsdPolicy(
      [{ ...attribute("critical_warning", 0b1001), status: "failed" }],
      NO_SSD_CONTEXT,
    );
    expect(decoded?.reason).toBe(
      "Critical warning: available spare below threshold, media read-only",
    );
  });

  it("derives ATA wear from the normalised wear attribute", () => {
    expect(statusOf(attribute("177", 21), ata())).toBe("passed");
    expect(statusOf(attribute("177", 20), ata())).toBe("warning");
    expect(statusOf(attribute("177", 0), ata())).toBe("failed");
  });

  it("prefers device statistic percentage used for ATA wear", () => {
    expect(statusOf(attribute("177", 99), ata(85))).toBe("warning");
    expect(statusOf(attribute("177", 5), ata(10))).toBe("passed");
  });

  it("warns on ATA reserved space within 10 of the vendor threshold", () => {
    expect(statusOf(attribute("170", 21, 10), ata())).toBe("passed");
    expect(statusOf(attribute("170", 20, 10), ata())).toBe("warning");
    expect(statusOf(attribute("170", 20, 10))).toBe("passed");
  });
});
