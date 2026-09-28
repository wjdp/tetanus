import { describe, expect, it } from "vitest";
import {
  effectiveDeviceStatus,
  healthStatus,
  overlayStatus,
  worstStatus,
} from "./status";

describe("worstStatus", () => {
  it("is unknown with nothing to compare", () => {
    expect(worstStatus()).toBe("unknown");
  });

  it("ranks failed over warning over passed over unknown", () => {
    expect(worstStatus("passed", "unknown")).toBe("passed");
    expect(worstStatus("passed", "warning", "unknown")).toBe("warning");
    expect(worstStatus("warning", "failed", "passed")).toBe("failed");
    expect(worstStatus("unknown", "unknown")).toBe("unknown");
  });
});

describe("healthStatus", () => {
  it("fails on a failed self-assessment or the disk-failing exit bit", () => {
    expect(healthStatus(false, 0)).toBe("failed");
    expect(healthStatus(true, 8)).toBe("failed");
    expect(healthStatus(null, 8 | 64)).toBe("failed");
  });

  it("passes on a passed self-assessment and is unknown without one", () => {
    expect(healthStatus(true, 64)).toBe("passed");
    expect(healthStatus(null, 0)).toBe("unknown");
    expect(healthStatus(true, null)).toBe("passed");
  });
});

describe("overlayStatus", () => {
  it("shows accepted while the value stays at or below the accepted value", () => {
    expect(overlayStatus("failed", 16, { acceptedValue: 16 })).toBe("accepted");
    expect(overlayStatus("warning", 12, { acceptedValue: 16 })).toBe(
      "accepted",
    );
  });

  it("shows the real status once the value rises or without an acceptance", () => {
    expect(overlayStatus("failed", 17, { acceptedValue: 16 })).toBe("failed");
    expect(overlayStatus("failed", 16, null)).toBe("failed");
  });

  it("leaves passed attributes alone", () => {
    expect(overlayStatus("passed", 0, { acceptedValue: 16 })).toBe("passed");
  });
});

describe("effectiveDeviceStatus", () => {
  const attributes = [
    { attrId: "197", status: "failed" as const, transformedValue: 16 },
    { attrId: "198", status: "warning" as const, transformedValue: 18 },
    { attrId: "5", status: "passed" as const, transformedValue: 0 },
  ];

  it("is the worst of health and the un-accepted attributes", () => {
    expect(effectiveDeviceStatus("passed", attributes, new Map())).toBe(
      "failed",
    );
    expect(
      effectiveDeviceStatus(
        "passed",
        attributes,
        new Map([["197", { acceptedValue: 16 }]]),
      ),
    ).toBe("warning");
    expect(
      effectiveDeviceStatus(
        "passed",
        attributes,
        new Map([
          ["197", { acceptedValue: 16 }],
          ["198", { acceptedValue: 20 }],
        ]),
      ),
    ).toBe("passed");
  });

  it("never hides a failed self-assessment", () => {
    expect(
      effectiveDeviceStatus(
        "failed",
        attributes,
        new Map([
          ["197", { acceptedValue: 16 }],
          ["198", { acceptedValue: 18 }],
        ]),
      ),
    ).toBe("failed");
  });
});
