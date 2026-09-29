import { describe, expect, it } from "vitest";
import {
  classifyInterface,
  classifyMedia,
  interfaceLabel,
  resolveRecordingTech,
  sectorFormat,
} from "./hardware";

describe("classifyMedia", () => {
  it.each([
    [{ rotationRate: 5400 }, "hdd"],
    [{ rotationRate: 7200, rotational: false }, "hdd"],
    [{ rotationRate: 0 }, "ssd"],
    [{ rotationRate: 0, rotational: true }, "ssd"],
    [{ protocol: "nvme" }, "ssd"],
    [{ protocol: "NVMe", rotational: true }, "ssd"],
    [{ protocol: "ata", rotational: false }, "ssd"],
    [{ protocol: "scsi", rotational: true }, "hdd"],
    [{ rotational: false }, "ssd"],
    [{ rotational: true }, "hdd"],
    [{ protocol: "scsi" }, "unknown"],
    [{}, "unknown"],
  ] as const)("%o is %s", (input, media) => {
    expect(classifyMedia(input)).toBe(media);
  });
});

describe("classifyInterface", () => {
  it.each([
    [{ protocol: "ata", deviceType: "sat", link: "sas" }, "sata"],
    [{ protocol: "ata", sataVersion: "SATA 3.3", link: "sata" }, "sata"],
    [{ protocol: "scsi", deviceType: "sat" }, "sata"],
    [{ protocol: "nvme", deviceType: "nvme", link: "nvme" }, "nvme"],
    [{ protocol: "scsi", scsiTransport: "SAS (SPL-4)" }, "sas"],
    [{ protocol: "scsi", scsiTransport: "SAS" }, "sas"],
    [{ protocol: "scsi", scsiTransport: "Fibre Channel" }, "unknown"],
    [{ protocol: "scsi", link: "sas" }, "unknown"],
    [{ protocol: "ata", deviceType: "ata", link: "usb" }, "sata"],
    [{ protocol: "ata", deviceType: "ata" }, "unknown"],
    [{ link: "sata" }, "sata"],
    [{ link: "nvme" }, "nvme"],
    [{ link: "sas" }, "unknown"],
    [{ link: "usb" }, "unknown"],
    [{}, "unknown"],
  ] as const)("%o is %s", (input, driveInterface) => {
    expect(classifyInterface(input)).toBe(driveInterface);
  });
});

describe("interfaceLabel", () => {
  it.each([
    ["sata", "sas", "SATA via SAS"],
    ["sata", "usb", "SATA via USB"],
    ["sata", "sata", "SATA"],
    ["sata", null, "SATA"],
    ["nvme", "nvme", "NVMe"],
    ["sas", "sas", "SAS"],
    ["usb", "usb", "USB"],
    ["unknown", "sas", "SAS"],
    ["unknown", null, null],
    [null, null, null],
  ] as const)("%s over %s is %s", (driveInterface, link, label) => {
    expect(interfaceLabel(driveInterface, link)).toBe(label);
  });
});

describe("sectorFormat", () => {
  it.each([
    [512, 512, "512n"],
    [512, 4096, "512e"],
    [4096, 4096, "4Kn"],
    [512, null, null],
    [null, null, null],
    [4096, 512, null],
  ] as const)("%s/%s is %s", (logical, physical, format) => {
    expect(sectorFormat(logical, physical)).toBe(format);
  });
});

describe("resolveRecordingTech", () => {
  it("is null for anything but an hdd", () => {
    for (const media of ["ssd", "unknown", null] as const) {
      expect(
        resolveRecordingTech({ media, override: "smr", trimSupported: true }),
      ).toEqual({ recordingTech: null, inferred: false });
    }
  });

  it("prefers the inventory override over everything", () => {
    expect(
      resolveRecordingTech({
        media: "hdd",
        override: "cmr",
        datasetRecordingTech: "smr",
        modelFamily: "Western Digital Red (SMR)",
        trimSupported: true,
      }),
    ).toEqual({ recordingTech: "cmr", inferred: false });
  });

  it("prefers the dataset over the model family", () => {
    expect(
      resolveRecordingTech({
        media: "hdd",
        datasetRecordingTech: "smr",
        modelFamily: "Western Digital Red (CMR)",
      }),
    ).toEqual({ recordingTech: "smr", inferred: false });
  });

  it("ignores an empty dataset value", () => {
    expect(
      resolveRecordingTech({
        media: "hdd",
        datasetRecordingTech: "",
        modelFamily: "Western Digital Red (CMR)",
      }),
    ).toEqual({ recordingTech: "cmr", inferred: false });
  });

  it.each([
    ["Western Digital Red (CMR)", "cmr"],
    ["Western Digital Red (SMR)", "smr"],
    ["Seagate Exos X (CMR+HAMR)", "cmr"],
    ["Seagate Archive HDD (SMR)", "smr"],
  ] as const)("reads %s from the model family as %s", (modelFamily, tech) => {
    expect(
      resolveRecordingTech({ media: "hdd", modelFamily, trimSupported: true }),
    ).toEqual({ recordingTech: tech, inferred: false });
  });

  it("infers SMR from TRIM on an hdd", () => {
    expect(
      resolveRecordingTech({
        media: "hdd",
        modelFamily: "Seagate Barracuda 3.5",
        trimSupported: true,
      }),
    ).toEqual({ recordingTech: "smr", inferred: true });
  });

  it("is unknown when nothing says", () => {
    expect(
      resolveRecordingTech({
        media: "hdd",
        modelFamily: "Seagate Exos X18",
        trimSupported: false,
      }),
    ).toEqual({ recordingTech: "unknown", inferred: false });
  });
});
