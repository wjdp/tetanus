import { describe, expect, it } from "vitest";
import {
  ATTRIBUTE_STATUS_DOT,
  attributeNote,
  CONTEXT_RATE_NOTE,
  countByStatus,
  isNotableContextRate,
  isShownByDefault,
  orderAttributes,
} from "./attributeRows";

type Status = "passed" | "warning" | "failed" | "accepted";

const attribute = (
  attrId: string,
  displayStatus: Status,
  failureRate: number | null = null,
) => ({
  attrId,
  displayStatus,
  failureRate,
});

const ids = (attributes: { attrId: string }[]) =>
  attributes.map((entry) => entry.attrId);

describe("orderAttributes", () => {
  it("groups failed, warning, accepted, defect, notable context, then the rest", () => {
    const ordered = orderAttributes([
      attribute("9", "passed", 0.02),
      attribute("194", "passed", 0.15),
      attribute("198", "passed"),
      attribute("5", "accepted"),
      attribute("4", "warning"),
      attribute("197", "failed"),
    ]);

    expect(ids(ordered)).toEqual(["197", "4", "5", "198", "194", "9"]);
  });

  it("sorts by numeric attrId within a group", () => {
    const ordered = orderAttributes([
      attribute("198", "failed"),
      attribute("10", "failed"),
      attribute("5", "failed"),
      attribute("194", "passed"),
      attribute("12", "passed"),
      attribute("9", "passed"),
    ]);

    expect(ids(ordered)).toEqual(["5", "10", "198", "9", "12", "194"]);
  });

  it("keeps non-numeric ids after numeric ones in source order", () => {
    const ordered = orderAttributes([
      attribute("temperature", "passed"),
      attribute("critical_warning", "passed"),
      attribute("12", "passed"),
      attribute("available_spare", "passed"),
    ]);

    expect(ids(ordered)).toEqual([
      "12",
      "temperature",
      "critical_warning",
      "available_spare",
    ]);
  });

  it("does not mutate its input", () => {
    const input = [attribute("1", "passed"), attribute("5", "failed")];
    orderAttributes(input);
    expect(input[0].attrId).toBe("1");
  });
});

describe("isShownByDefault", () => {
  it("shows defect attributes even when passed", () => {
    expect(isShownByDefault(attribute("197", "passed"))).toBe(true);
  });

  it("shows any failed, warning or accepted attribute", () => {
    expect(isShownByDefault(attribute("9", "failed"))).toBe(true);
    expect(isShownByDefault(attribute("9", "warning"))).toBe(true);
    expect(isShownByDefault(attribute("9", "accepted"))).toBe(true);
  });

  it("shows context attributes only at a notable fleet rate", () => {
    expect(isShownByDefault(attribute("194", "passed", 0.15))).toBe(true);
    expect(isShownByDefault(attribute("194", "passed", 0.05))).toBe(false);
    expect(isShownByDefault(attribute("temperature", "passed"))).toBe(false);
  });
});

describe("attributeNote", () => {
  const noted = (
    attrId: string,
    reason: string | null,
    failureRate: number | null,
    acceptanceNote?: string,
  ) => ({
    ...attribute(attrId, "passed", failureRate),
    reason,
    acceptance: acceptanceNote === undefined ? null : { note: acceptanceNote },
  });

  it("prefers the evaluator reason", () => {
    expect(attributeNote(noted("194", "hot", 0.2, "fine"))).toBe("hot");
  });

  it("falls back to the context-rate note, then the acceptance note", () => {
    expect(attributeNote(noted("194", null, 0.2, "fine"))).toBe(
      CONTEXT_RATE_NOTE,
    );
    expect(attributeNote(noted("5", null, 0.2, "fine"))).toBe("fine");
  });

  it("has nothing to say otherwise", () => {
    expect(attributeNote(noted("5", null, null, ""))).toBeNull();
    expect(attributeNote(noted("9", null, 0.01))).toBeNull();
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

describe("ATTRIBUTE_STATUS_DOT", () => {
  it("draws no dot for passed", () => {
    expect(ATTRIBUTE_STATUS_DOT.passed).toBeNull();
  });

  it("fills the dot for a live fault", () => {
    expect(ATTRIBUTE_STATUS_DOT.warning).toEqual({
      colour: "warning",
      shape: "filled",
    });
    expect(ATTRIBUTE_STATUS_DOT.failed).toEqual({
      colour: "error",
      shape: "filled",
    });
  });

  it("draws an accepted fault as a hollow warning ring", () => {
    expect(ATTRIBUTE_STATUS_DOT.accepted).toEqual({
      colour: "warning",
      shape: "hollow",
    });
  });
});
