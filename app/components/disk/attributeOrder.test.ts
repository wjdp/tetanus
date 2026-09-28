import { describe, expect, it } from "vitest";
import {
  countByStatus,
  defaultAttributeId,
  orderAttributes,
} from "./attributeOrder";

const attribute = (
  attrId: string,
  status: "passed" | "warning" | "failed",
) => ({
  attrId,
  status,
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
  it("counts failed and warning attributes", () => {
    expect(
      countByStatus([
        attribute("1", "failed"),
        attribute("2", "warning"),
        attribute("3", "warning"),
        attribute("4", "passed"),
      ]),
    ).toEqual({ failed: 1, warning: 2 });
  });
});
