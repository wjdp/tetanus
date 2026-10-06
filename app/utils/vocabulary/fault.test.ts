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
  path: "/disks/12",
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
    ["pool", "/zfs/nas1/tank"],
    ["host", "/hosts/nas1"],
    ["replication", "/replications/12"],
  ] as const)("links a %s to %s", (type, path) => {
    expect(faultSubjectPath(subject({ type, path }))).toBe(path);
  });

  it("has no link for a removed subject", () => {
    expect(faultSubjectPath(subject({ type: "pool", path: null }))).toBeNull();
    expect(
      faultSubjectPath(subject({ path: null }), "smart-attribute"),
    ).toBeNull();
  });

  it("opens the SMART tab for a SMART fault on a disk", () => {
    expect(
      faultSubjectPath(subject({ id: 3, path: "/disks/3" }), "smart-attribute"),
    ).toBe("/disks/3?tab=smart");
    expect(
      faultSubjectPath(
        subject({ id: 3, path: "/disks/3" }),
        "smart-health-failed",
      ),
    ).toBe("/disks/3?tab=smart");
    expect(
      faultSubjectPath(subject({ id: 3, path: "/disks/3" }), "disk-missing"),
    ).toBe("/disks/3");
  });

  it("opens the FARM tab for a SMART counters reset", () => {
    expect(
      faultSubjectPath(
        subject({ id: 3, path: "/disks/3" }),
        "smart-counters-reset",
      ),
    ).toBe("/disks/3?tab=farm");
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
