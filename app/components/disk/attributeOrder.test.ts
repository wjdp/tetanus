import { describe, expect, it } from "vitest";
import {
  countByStatus,
  defaultAttributeId,
  isNotableContextRate,
  orderAttributes,
} from "./attributeOrder";

const attribute = (
  attrId: string,
  displayStatus: "passed" | "warning" | "failed" | "accepted",
) => ({
  attrId,
  displayStatus,
});

describe("orderAttributes", () => {
  it("puts failed then warning first and keeps source order within a status", () => {
    const ordered = orderAttributes([
      attribute("1", "passed"),
      attribute("5", "warning"),
      attribute("9", "passed"),
      attribute("197", "failed"),
      attribute("198", "warning"),
    ]);

    expect(ordered.map((entry) => entry.attrId)).toEqual([
      "197",
      "5",
      "198",
      "1",
      "9",
    ]);
  });

  it("places accepted between warning and passed", () => {
    const ordered = orderAttributes([
      attribute("1", "passed"),
      attribute("197", "accepted"),
      attribute("5", "warning"),
      attribute("198", "failed"),
    ]);

    expect(ordered.map((entry) => entry.attrId)).toEqual([
      "198",
      "5",
      "197",
      "1",
    ]);
  });

  it("does not mutate its input", () => {
    const input = [attribute("1", "passed"), attribute("5", "failed")];
    orderAttributes(input);
    expect(input[0].attrId).toBe("1");
  });
});

describe("defaultAttributeId", () => {
  it("selects the first non-passed attribute", () => {
    expect(
      defaultAttributeId(
        [attribute("194", "passed"), attribute("5", "warning")],
        "ata",
      ),
    ).toBe("5");
  });

  it("does not select an accepted attribute over temperature", () => {
    expect(
      defaultAttributeId(
        [attribute("197", "accepted"), attribute("194", "passed")],
        "ata",
      ),
    ).toBe("194");
  });

  it("falls back to temperature for the protocol", () => {
    expect(
      defaultAttributeId(
        [attribute("1", "passed"), attribute("194", "passed")],
        "ata",
      ),
    ).toBe("194");
    expect(
      defaultAttributeId(
        [
          attribute("critical_warning", "passed"),
          attribute("temperature", "passed"),
        ],
        "nvme",
      ),
    ).toBe("temperature");
  });

  it("falls back to the first attribute, or null when there are none", () => {
    expect(defaultAttributeId([attribute("1", "passed")], "scsi")).toBe("1");
    expect(defaultAttributeId([], "ata")).toBeNull();
  });
});

describe("countByStatus", () => {
  it("counts failed, warning and accepted attributes", () => {
    expect(
      countByStatus([
        attribute("1", "failed"),
        attribute("2", "warning"),
        attribute("3", "warning"),
        attribute("4", "passed"),
        attribute("5", "accepted"),
      ]),
    ).toEqual({ failed: 1, warning: 2, accepted: 1 });
  });
});

describe("isNotableContextRate", () => {
  const rate = (attrId: string, failureRate: number | null) => ({
    attrId,
    failureRate,
  });

  it("flags a context attribute at or above a 10 % fleet rate", () => {
    expect(isNotableContextRate(rate("4", 0.12))).toBe(true);
    expect(isNotableContextRate(rate("4", 0.1))).toBe(true);
    expect(isNotableContextRate(rate("temperature", 0.5))).toBe(true);
  });

  it("ignores a context attribute below 10 %", () => {
    expect(isNotableContextRate(rate("4", 0.05))).toBe(false);
    expect(isNotableContextRate(rate("4", 0.099))).toBe(false);
  });

  it("ignores defect attributes, whose rate already drives status", () => {
    expect(isNotableContextRate(rate("197", 0.3))).toBe(false);
    expect(isNotableContextRate(rate("5", 0.1))).toBe(false);
  });

  it("ignores a missing rate", () => {
    expect(isNotableContextRate(rate("4", null))).toBe(false);
  });
});
