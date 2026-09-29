import { describe, expect, it } from "vitest";
import type { DriveSpec } from "#shared/drive-spec";
import { lookupSpec } from "~~/server/services/drive-db/lookup";
import {
  deriveHardware,
  hardwareHintsFromLsblk,
  normaliseFormFactor,
  type PreviousHardware,
  reconcileWithSpec,
  specInterface,
  zonedChanges,
} from "~~/server/services/hardware";

const exos = lookupSpec("ST12000NM000J-2TY103") as DriveSpec;
const sn750 = lookupSpec("WDS250G3X0C-00SJG0") as DriveSpec;

describe("normaliseFormFactor", () => {
  it.each([
    ["3.5 inches", "3.5"],
    ["2.5 inches", "2.5"],
    ['2.5"', "2.5"],
    ["3.5", "3.5"],
    ["m.2", "M.2"],
    ["U.2", "U.2"],
    ["", null],
    [null, null],
  ])("%s → %s", (input, expected) => {
    expect(normaliseFormFactor(input)).toBe(expected);
  });
});

describe("specInterface", () => {
  it.each([
    ["SATA", "sata"],
    ["SAS", "sas"],
    ["NVMe", "nvme"],
    [null, undefined],
  ] as const)("%s → %s", (input, expected) => {
    expect(specInterface(input)).toBe(expected);
  });
});

describe("reconcileWithSpec", () => {
  const observedExos = {
    rotationRate: 7200,
    formFactor: "3.5 inches",
    interface: "sata",
    media: "hdd",
  } as const;

  it("reports no mismatch when observation and dataset agree", () => {
    expect(reconcileWithSpec(observedExos, exos)).toEqual({
      filled: observedExos,
      specMismatch: [],
    });
  });

  it("fills what the observation lacks from the dataset", () => {
    expect(
      reconcileWithSpec({ interface: "nvme", media: "ssd" }, sn750),
    ).toEqual({
      filled: { formFactor: "M.2", interface: "nvme", media: "ssd" },
      specMismatch: [],
    });
    expect(reconcileWithSpec({}, exos).filled).toEqual(observedExos);
  });

  it("treats unknown as unobserved", () => {
    expect(
      reconcileWithSpec({ interface: "unknown", media: "unknown" }, exos)
        .filled,
    ).toMatchObject({ interface: "sata", media: "hdd" });
  });

  it("keeps the observation and records each disagreement", () => {
    expect(
      reconcileWithSpec(
        {
          rotationRate: 5400,
          formFactor: "2.5 inches",
          interface: "sas",
          media: "ssd",
        },
        exos,
      ),
    ).toEqual({
      filled: {
        rotationRate: 5400,
        formFactor: "2.5 inches",
        interface: "sas",
        media: "ssd",
      },
      specMismatch: [
        "rotationRate: observed 5400, dataset 7200",
        "formFactor: observed 2.5 inches, dataset 3.5",
        "interface: observed sas, dataset SATA",
        "media: observed ssd, dataset hdd",
      ],
    });
  });

  it("passes the observation through without a spec", () => {
    expect(reconcileWithSpec(observedExos, null)).toEqual({
      filled: observedExos,
      specMismatch: [],
    });
  });
});

describe("hardwareHintsFromLsblk", () => {
  it("passes sector sizes through as hints", () => {
    expect(
      hardwareHintsFromLsblk({
        rotational: true,
        link: "sata",
        logicalBlockSize: 512,
        physicalBlockSize: 4096,
      }),
    ).toEqual({
      media: "hdd",
      interface: "sata",
      logicalBlockSize: 512,
      physicalBlockSize: 4096,
    });
    expect(
      hardwareHintsFromLsblk({
        rotational: false,
        link: "nvme",
        logicalBlockSize: null,
        physicalBlockSize: null,
      }),
    ).toEqual({ media: "ssd", interface: "nvme" });
  });
});

describe("zonedChanges", () => {
  it("stores a zoned model, drops it when gone, ignores none", () => {
    expect(zonedChanges({ hardware: null }, "host-managed")).toEqual({
      hardware: { zoned: "host-managed" },
    });
    expect(
      zonedChanges({ hardware: { zoned: "host-managed" } }, "none"),
    ).toEqual({ hardware: {} });
    expect(zonedChanges({ hardware: null }, "none")).toBeNull();
    expect(zonedChanges({ hardware: null }, null)).toBeNull();
    expect(
      zonedChanges({ hardware: { zoned: "host-aware" } }, "host-aware"),
    ).toBeNull();
  });
});

describe("deriveHardware", () => {
  const previous: PreviousHardware = {
    model: "ST12000NM000J-2TY103",
    modelFamily: null,
    media: "hdd",
    trimSupported: false,
    inventory: {},
    specs: { ...exos, line: "kept from last lookup" },
    hardware: {
      sataVersion: "SATA 3.3",
      recordingTechInferred: true,
      specMismatch: ["stale"],
    },
    vendor: "seagate",
  };

  it("reuses stored specs while model and snapshot are unchanged", () => {
    const derived = deriveHardware(previous, { model: previous.model });
    expect(derived.specs?.line).toBe("kept from last lookup");
  });

  it("looks specs up again when the model changes", () => {
    const derived = deriveHardware(previous, {
      model: "ST16000NM001G-2KK103",
    });
    expect(derived.specs?.matchedModel).toBe("ST16000NM001G");
  });

  it("keeps observed hardware and recomputes derived flags", () => {
    expect(deriveHardware(previous, {}).hardware).toEqual({
      sataVersion: "SATA 3.3",
    });
  });

  it("carries the lsblk zoned model through a smartctl observation", () => {
    const zoned = {
      ...previous,
      hardware: { ...previous.hardware, zoned: "host-managed" },
    };
    const derived = deriveHardware(zoned, {
      hardware: { sataVersion: "SATA 3.2" },
    });
    expect(derived.hardware).toEqual({
      sataVersion: "SATA 3.2",
      zoned: "host-managed",
    });
    expect(derived.recordingTech).toBe("smr");
  });

  it("detects the vendor from WWN, then keeps the previous one", () => {
    expect(deriveHardware(undefined, { wwn: "5000c500a1b2c3d4" }).vendor).toBe(
      "seagate",
    );
    expect(
      deriveHardware({ ...previous, model: null, specs: null }, {}).vendor,
    ).toBe("seagate");
  });

  it("resolves recording tech from a freshly looked-up spec", () => {
    expect(
      deriveHardware(undefined, {
        model: "ST12000NM000J-2TY103",
        rotationRate: 7200,
      }),
    ).toMatchObject({ media: "hdd", recordingTech: "cmr", hardware: null });
  });
});
