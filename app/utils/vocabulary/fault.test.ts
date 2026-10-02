import { describe, expect, it } from "vitest";
import type { FaultSubject } from "#shared/faults";
import { faultGutterColour, faultHostLabel, faultSubjectPath } from "./fault";

describe("faultGutterColour", () => {
  it.each([
    ["open", "error", "error"],
    ["open", "warning", "warning"],
    ["acknowledged", "error", "warning"],
    ["acknowledged", "warning", "warning"],
    ["accepted", "error", null],
    ["resolved", "error", null],
  ] as const)("%s %s is %s", (state, severity, colour) => {
    expect(faultGutterColour({ state, severity })).toBe(colour);
  });
});

const subject = (overrides: Partial<FaultSubject>): FaultSubject => ({
  type: "disk",
  id: 12,
  label: "A7",
  hostName: "atlas",
  ...overrides,
});

describe("faultHostLabel", () => {
  it("prefers the subject's host", () => {
    expect(faultHostLabel({ subject: subject({}) })).toBe("atlas");
  });

  it("falls back to the subject label", () => {
    expect(faultHostLabel({ subject: subject({ hostName: null }) })).toBe("A7");
  });
});

describe("faultSubjectPath", () => {
  it.each([
    ["disk", "/disks/12"],
    ["pool", "/zfs/12"],
    ["host", "/settings/hosts"],
  ] as const)("links a %s to %s", (type, path) => {
    expect(faultSubjectPath(subject({ type }))).toBe(path);
  });
});
