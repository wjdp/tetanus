import { describe, expect, it } from "vitest";
import type { FaultSubject } from "#shared/faults";
import {
  faultDiskPath,
  faultGutterColour,
  faultHostLabel,
  faultSubjectPath,
} from "./fault";

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
    ["host", "/hosts/12"],
    ["replication", "/replications/12"],
  ] as const)("links a %s to %s", (type, path) => {
    expect(faultSubjectPath(subject({ type }))).toBe(path);
  });
});

describe("faultDiskPath", () => {
  it("links a leaf fault's disk", () => {
    expect(
      faultDiskPath({
        subject: subject({ type: "pool" }),
        data: { diskId: 4 },
      }),
    ).toBe("/disks/4");
  });

  it("has no disk link for an unlinked leaf or a disk subject", () => {
    expect(
      faultDiskPath({
        subject: subject({ type: "pool" }),
        data: { diskId: null },
      }),
    ).toBeNull();
    expect(
      faultDiskPath({
        subject: subject({ type: "disk" }),
        data: { diskId: 4 },
      }),
    ).toBeNull();
  });
});
