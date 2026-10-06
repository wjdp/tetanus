import { describe, expect, it } from "vitest";
import type { FaultSeverity, FaultSubject } from "#shared/faults";
import { faultCountLabel, summariseSubjectFaults } from "./faultSummary";

const subject = (
  type: FaultSubject["type"],
  id: number,
  label: string,
): FaultSubject => ({ type, id, label, hostName: "mars", path: null });

const fault = (on: FaultSubject, severity: FaultSeverity) => ({
  subject: on,
  severity,
});

describe("summariseSubjectFaults", () => {
  it("counts faults per disk and pool, worst first, leaving out the host", () => {
    const sda = subject("disk", 1, "sda");
    const tank = subject("pool", 2, "tank");
    const sdb = subject("disk", 3, "sdb");

    const summaries = summariseSubjectFaults([
      fault(subject("host", 1, "mars"), "error"),
      fault(sda, "warning"),
      fault(tank, "error"),
      fault(sda, "warning"),
      fault(sdb, "warning"),
    ]);

    expect(
      summaries.map(({ subject, errors, warnings }) => [
        subject.label,
        errors,
        warnings,
      ]),
    ).toEqual([
      ["tank", 1, 0],
      ["sda", 0, 2],
      ["sdb", 0, 1],
    ]);
  });
});

describe("faultCountLabel", () => {
  it("names errors before warnings", () => {
    expect(
      faultCountLabel({
        subject: subject("disk", 1, "sda"),
        errors: 1,
        warnings: 2,
      }),
    ).toBe("1 error · 2 warnings");
  });
});
